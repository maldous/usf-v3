import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";
import test from "node:test";
import ts from "typescript";
import { parse as parseYaml } from "yaml";
import { loadSemanticGraph, objectsFor, objectValues, validationRuntimeClosure, type SemanticGraph } from "../../src/graph/index.ts";
import { deriveWork } from "../../src/graph/work.ts";
import { constructionGrantIri, constructionReceiptPath, deriveConstructionAuthority, validateConstructionReceiptShape } from "../../src/realisation/construction-authority.ts";
import { evidenceCommandHandler, proveCommandHandler, constructionAwarePublishCommandHandler } from "../../src/commands/construction-authority.ts";
import { prepareLinearBinding, observeLinearBinding, withNativeLinearCompletion, beforeHermesDispatch, afterHermesResult, afterHermesRefusal, type GraphExecutionEvidenceDigest, type LinearBindingSelector, type PreparedLinearBinding } from "../../src/commands/linear-binding.ts";
import { canonicalDigest, canonicalJson, sha256 } from "../../src/core/canonical.ts";
import { canonicalQuadDigest, parseStrictNQuads } from "../../src/graph/nquads.ts";
import { executeLinearDelivery, resumeLinearDeliveryContinuation } from "../../src/commands/linear-delivery.ts";
import { classifyProbeQualifyMetadataDeltaForTest, prepareLinearMetadataContinuation } from "../../src/commands/linear-continuation.ts";
import { contributionFromSettledLinearResult } from "../../src/commands/linear-contribution.ts";
import { resolveCommand } from "../../src/commands/resolve.ts";
import { apply, integrateCommandHandler } from "../../src/commands/apply.ts";
import { runGraphDerivedCheck } from "../../src/commands/check.ts";
import { graphExecuteCommand, sdkInvocationLimits, sdkPreflightRefusal } from "../../src/commands/graph-execute.ts";
import { probeCommandHandler } from "../../src/commands/probe.ts";
import { LinearStateStore, readLinearRecord } from "../../src/commands/linear-state.ts";
import { normalizeModelsDevCatalogue } from "../../src/providers/catalogue.ts";
import { observeInstalledAdapter, readLocalCatalogue } from "../../src/commands/models.ts";
import { loadCredentialEnvFile } from "../../src/providers/config.ts";
import { readProviderBindings } from "../../src/providers/provider-bindings.ts";
import { readProviderExecutionPolicy } from "../../src/providers/provider-policy.ts";
import { readGraphDerivedEconomics } from "../../src/providers/economics-projection.ts";
import { classifyCatalogue } from "../../src/providers/classification.ts";
import { deriveRouteUniverse } from "../../src/providers/route-universe.ts";
import { observeQualifiedTaskClasses } from "../../src/providers/capabilities.ts";
import { observeAvailableRoutes } from "../../src/providers/evidence-index.ts";
import { UsfError } from "../../src/core/errors.ts";
import { candidateScope, deriveCandidatePreimages, authenticateCandidateWorkspace, inspectCandidateIntegrationRecovery,
  integrateCandidates, prepareCandidateIntegration } from "../../src/realisation/index.ts";
import { verifyTransitionActivationCurrentness } from "../../src/realisation/transition.ts";

const sourceRoot = resolve(import.meta.dirname, "../..");
const work = "urn:usf:work:linear-work-binding";
const profile = "urn:usf:profile:linear-work-binding:1";
const manifestPath = "graph/manifests/linear-work-binding.json";
const bindingManifestPath = "graph/manifests/linear-issue-bindings.json";
const bindingGraphPath = "graph/linear-issue-bindings.nq";
const bindingIri = "urn:usf:linear-binding:native-completion-integration:1";
const successorIri = "urn:usf:linear-binding:native-completion-integration:2";
const predecessorIri = "urn:usf:linear-binding:native-completion-integration:0";
const execFileAsync = promisify(execFile);

function object(value: unknown): Record<string, unknown> {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function fixtureBinding(iri: string, supersedes?: string): string {
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
    ...(supersedes === undefined ? [] : ([
      ["realisationDisposition", "no-change", false],
      ["supersedesBinding", supersedes, true],
    ] as const)),
  ];
  return fields.map(([name, value, objectIri]) => `<${iri}> <urn:usf:predicate:${name}> ${objectIri ? `<${value}>` : JSON.stringify(value)} <${graph}> .`).join("\n") + "\n";
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
  await writeFile(resolve(root, bindingGraphPath), fixtureBinding(predecessorIri) + fixtureBinding(bindingIri, predecessorIri));
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
  const settledNativeIssueBytes = await readFile(predecessor.issuePath);

  // A second native binding is a real lifecycle successor, not a reason to
  // erase or reinterpret the settled native journal. Receipt drift refuses
  // before the issue pointer or any effect can move.
  await writeFile(resolve(root, bindingGraphPath),
    await readFile(resolve(root, bindingGraphPath), "utf8") + fixtureBinding(successorIri, bindingIri));
  const successor = { ...selector, bindingIri: successorIri };
  const beforeSuccessor = await durableLedgerBytes(root);
  await writeFile(resolve(root, receiptPath as string), receiptBytes.toString("utf8").replace('"status":"verified"', '"status":"altered"'));
  await assert.rejects(prepareLinearBinding(successor),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === "LINEAR_BINDING_NATIVE_COMPLETION_UNPROVEN");
  assert.deepEqual(await durableLedgerBytes(root), beforeSuccessor);
  await writeFile(resolve(root, receiptPath as string), receiptBytes);

  const successorPrepared = await prepareLinearBinding(successor);
  assert.equal(successorPrepared.status, "PREPARED");
  let successorEffects = 0;
  const successorResult = await withNativeLinearCompletion(successor, successorPrepared.binding.unit.attemptKey, async () => {
    successorEffects += 1;
    return { repeated: true };
  });
  assert.equal(successorEffects, 0, "current semantic completion must not repeat a native effect");
  assert.equal(successorResult.result, null);
  assert.equal(successorResult.binding.status, "COMPLETED");
  assert.equal((await observeLinearBinding(successor)).status, "COMPLETED");
  const successorArchive = resolve(root,
    ".usf/work/linear/" + successorPrepared.binding.unit.intentKey.slice(7) + "/predecessor-issue.json");
  assert.deepEqual(await readFile(successorArchive), settledNativeIssueBytes);
});

// Two independent native lanes exercise current capture and an exact historical
// producer. Neither imports canonical operational state or Git, rewrites an
// intent, fabricates receipts, or substitutes no-change completion.
import type { TestContext as NativeQualificationContext } from "node:test";
import {
  deriveNoChangeCompletionAuthority as fixtureCompletionAuthority,
  workCompletionAuthorityDependencies as fixtureCompletionDependencies,
} from "../../src/realisation/work-completion.ts";

// Exact historical module retained by authenticated native intent
// sha256:40164c9ad8bbad2ee67adc5dba05e20c94b35584049e9ed8b0b7051a4a0fa8aa.
// Fixture data only: no historical runtime flag or operational-state dependency.
const historicalContinuationProducer = Object.freeze({
  rawDigest: "sha256:239fd689fe1caff38903cef15932c217137be1e1cb325dcd424103f540eb7fc4",
  rawBytes: 57795,
  mode: 436,
  compressedBytes: 13634,
  compressedDigest: "sha256:27da13ddbf51c17f45035ba169b521129e09d04dbd576a8209637c8e11d145da",
  encodedBytes: 18180,
  gzipBase64: [
    "H4sIAAAAAAACA819bXfbNrLwd/8KROeerNhQtJ2maVeu7KPISuqtY/vaSvf0sdUcWoJsbiRSS1JOvI7++z0zeBuAoCQ77b1PPzQyAQzeBoN5RzKbZ3nJHhj/",
    "wkdvkym/uE9HbMkmeTZjjTQb8/boNpmOP87zbMSLorG3lagmoywtyjgti5CNplmBTUM2Kcq4FD+n5mc256n4lfN4rDrCv6bzuLytdjux+honeRrPODSYxmVy",
    "h7+KbHrH7VYAyxpjnGZpMoqnh8kNL8rQfPhHkaUhK27jlz+81jCiaHuU5Xxb14pKaxjzOC/4OZ9nRVJm+f1ZXN5W2hajbM6ddtMsHl/wWZyWyehdHs9vQ5Zd",
    "/4uPyt/i6YIXYjKLfMTFMCnMG6i+naRj/sUBqgf534t4fJykvNos/fciHhdOuzHPkzsODeL8TZKOk/TmkI+mcR6XSZZWgUyxZutaVPUC+2eWfwpZeT/nDH6e",
    "xaNP3DOLz1n+yWkfL8pbDssSl7wXp+NkHJcIrpjHIx6yJC3mfFTqoqO05DdipOd8lN3x/D5kn5PyVtc4zkafaNeAYkmBLfzLCGicL0ZQ4V0ep+VRnoTW13M+",
    "4sm8hN0O5YR7pLi7KG+zPCnvQ3YXT3EMvWrri9t4zuvGRXtrxQqeu1Sjfy+SnJ/lySzO798vSmy7arplHqdFAj8dUGLzL8q45BdllnNxLMVXWNZ8HLLPeVJy",
    "+xNuMP2E6Gt6V6gC594+AthS9SuR7pwXi2lZbe1DNNn+bHE9BVRJsrR3y0ef5lmSliH93J9M+IgCXbW0W1jI5tk0Gd0f5QnrsMYiT9uLYtIWH9tyTBaUUZaW",
    "SbrA/tq7jT0JBj7n2XTK8/dxmkzgHHdYQ2D+TH4ptm95PuNFS8KNF2WWZrP76F9FlnogneXZJJlya2DiU9sPyDseOE8UBJzDmva+MeBKeNbGhoDIBptFhlDw",
    "KR+VfOwdwGiatOZ5dpeMed769yKeJhO5ia1bPp1XgKxYizWgPCNatUVroDl7dRunN3yMV0GHNYp8tD3KZrM4HcNeT+cC00TdeDTi8zJOR1xVL7HDSfKlXOR8",
    "fc8GAAU7xkvjLC5Lnqesw7b/ENda+zJuTXZafx8+vH61/K/txZ7G9yQtef4rx02d8TIex2VsoXWrwV64l2fzgZyUZRAV02TEmz8GGmzOx0jHWYc14bZus6LM",
    "k/QmUD9YZ5/unazehr6gvgI0i78ks8UMuISCddjuzstXqijn8ziRGLnuwJrJiFat2zgdZ5MJwQYK7gIvYIMPElBSFAuuaFIRpf/2nJAe/IpHJR3OSH5bdU63",
    "JosUSQrL+WRR8OYIeBizaim/4zl72GKsvM2zz+wUeYYoLorkJm2m/DPr53mWY7MgZA9AxYss7SEU+MiWwd7W0nRTxDPejNtskX5Ks89pyK7176DNrrNsyuMU",
    "4ZSLPLWZpWYcsE6n43y8DvYY6UCgYvMO7gUKWu4/TCWZsCaQ82zCsBp71oFzgxUa7OtX9szC56jUAINArVPj+Oik3z3/2Ds9GRydfOgOjk5PPh4evetfDD4e",
    "nfzWPT46bAR7W0xNBJvDSmxtf/cd6wG3OmaA9Owmj2ezOA9ZmpUsZoP7Ob8Y5cm8ZBwaxWWWsyxnMbvhKc/jKUtmc9jpz3Fyx/OIfbe9NZrGRcF+4dP5cVJC",
    "nXMej+W+ZZNJwQEvdmA08zy5g/MBrGrhfoQbOEun90xwgmrNoIq+fbK8aZcG7IGVt0kRFQp7xQ/YFMaQh2oGbXaXJWP2wD7fAv1sbl+yq/Iqv0qH2wuxvATE",
    "Jf4W4x6ygwPWaATs+XNGPrOfaZ/RlKc35W1Aa7x4IQZQxp94s+RfSoLUYixbjDEJRQxyD78AcjyjwIsyzsvin0l5i3BC2ssafHjfH3QPu4Pux3fn3ffvu+cN",
    "2QedyYsOA7ByDlCO64Zjbdp46xuuolfl6BbpbqN50L78o3F1dfVlZ6d19WV3cvXlx8nV4uXOy5/w/38ffr26gkqNq6vt60mal8Ovi8ud1t/j1qTbejt8eLUM",
    "gu8a24sIBLKmtRJIbq3pmzWTQ+h0WLqYTuEU4ZfLnaGcGttnP+3+/SWUvHiBQAQS7rOXP7x+2jqKydtHnXXYPy5OTyIUlJpqDGSgK0/+9mX9uilU3YQSbLjz",
    "zhKJOjbFEPgQ53l8//NgvwlntM2aAVxkg6DNBpdDihuI7o1Le4FyZHNF3Q67HIqySZaz5pSXDEUSpAXy588d9vqV/OPFi0DC92GfXNG6swvY0Bg2NIkwR1PO",
    "UYxMnFQFTQ6nA4PYcJHfnH44Obxo6EEJsNF8UdzigjUDXfTXz4HsQ6iGtKQb++gpQetJwqfjAgjCA5sv8nlWGPrMivs0mxdJob5cDvdYNofrsNDn4nLIllVM",
    "kaAawR792oa/JUslKrCOXDlJl/a80yTf1JDqIasaCjSieFNgttXX+s7kXD19YU1E8jHI+GVibj11OmRj3zAegfj0mmjw9A5Yx1OE3HBvDAW1Qg2cdoookLG/",
    "eLGnG0tsAlZpwnOewpXsQGBLVd2DnA/OchX3aRl/WblfZfylggh+rKd/j3mB/AyMqBY6qbSyC7ULGxzasOFyBNWxLinRkOspJhpaQ5ILuazinplthY0gOAf3",
    "zC6ylupAwW91BNQNCd8kOspPcmxQUIds2aKcL8qL0S2fxe3Gn8Ge6JWQYw31WQ31aVkKwrTc2uJfUD+iGXBkRpPJ/VmeXfP/Rgny/r2U8A75tIzfZvkA7tEk",
    "nS/KNh4HUJoacnbNJ1nO39yXvGizD0la/tSFQ7nH4knJ8+r3LSabvCfCC/uKjIhs5C3hX+YoiXe1TCvETMP4LgMtMOBoIxgobiYVur9+ZaLUjEIwFrs7O69f",
    "vWqYCnosVvmW3GIKBGdpOKeX7DuUQtU/NsTVlRXF2QgVLnqnZ31z7UhpSvRVt16BlhDYmKPQ12HNa3ebkKKCxDjgX8pDrJc3G4ty0vqpAZLjJC7jaZuVOejz",
    "gkhAEmBIB2J1WEf21KysWRCKHXermIUi0GZx/gmr/k0pEAzODrJ5MgJaBP82LxtY1ghZQ2hF7hvDkD38zcCaw5GEmbvykb5IlO5DKES1pBQhx3M6aYrREAKi",
    "q/7MdmDLvfVDA/GFnJAWiPY7bGdDGtB9/+bo3YfTDxc274iUhnVq+7D5TJQ6O7jLFWm0aUkRCDeU4F+w71/++PqnwOpZcDysI8FGigNyaVTOJ8mXNrOg70jI",
    "QciKxaRarrqVoCW1DFWfgriZrY1hAWB7mwLRgpBd60+IWDgq2DKFn52ORMOvX1kciUHiob9Wf2CBGJ0sEH+s3q+z89NBvzfoH3588/ugf/Gx90v35F1f6hro",
    "ETmaxTfKmNORVqb607KitnNw5MJLRdAk5/w/vCnwuxB3kKUcveZSi3iP+sOW1vWN4Spo7zZYXIhxhwijMvjqABHhy8R8aFerICzsQlWpqhI36IotAwEqmc0W",
    "ZXw95ef8JsnSeqAKHdWeGwTUm61gSohvAecueFkH81KztyHT/HrIDIc9lPDiyjW2mmxDK6Gd20Jt7CQecQbc41tQLz0YdZB9O+vPY+uy1LeqLp/hnZsuZtdw",
    "DGTpEvVfh7zk+SxJk6JMRmxujCfsOluk4zi/V2yE/L7HZklRJOnNNuxZcpMyvBikfnIGOsNiMQL7MCrE6niSHtHJEpNNc4tpZqCtlyBkHE057ap1J9QqMlM5",
    "F1Y28mkrgLOQxvP5NOHjBvvKGrJSa85Rm4vfdLliNSSp0ryGGIbk/RTHoca7pprssFIrNxZFxX5oiGJjaW1xVOSZMBfRTHEyuil8UfB8WlQPvGBNXTyTsqoe",
    "qmdYHTNc0mQNcLkMsGVOF88uPZ2Enh6GUZKOposxL9TGyfUTmksFr6l2YmyGi5qyA71Hejnxe5s5Laq7Z4ZNt1qD2clev3plBmCPrlOzu8+f+/qFEQWbMJJn",
    "H94cH/XE797pydvjo97AsJMEu1cPI1D3DDk/5PapX8vqCWubE6b071vsO3Y658KIH08ZB3NXOuIsKVALj5aT5HohLBboTcFOgaSVt7zgLLlJs5yPWZyXySQe",
    "lQAOrEcoABZsFt+zYjGfT/mMpyW0YYtUyguskD4YYPiRPhwtPJvSDBBt+ehXUlDKdQRkHU5uU1BmY+RASElRY+zQNIBqPOGjER1e7fz9tV77STwtuGJsPI4n",
    "2H3IGmAAbQQGT1R7YOXJpm3/cRUtisnVdvMAza9f5VYVX0fKc6IIsPSy2/p/ces/YDg0P6OPreF3V9vBdytKo+ZBG2yjX9N/B/+l9LUwSnHNEWOXcAECMt3M",
    "s0zfYqF12aG2DXbYEPU9JgWbN4vJRN9rUrWGtoNVe7VGID/rDn75+OHkovu2Txm6+LrIpgu0akqXIxyzGCvW295m/Xh0y/gXuFHTG2BNAfeSgo3AS4GPwY8F",
    "qBQUguY3TjXRBvhQGbYx2hLqMtm+o9yemmoM2B2qjvf2FD2Q6IENOh0GYwvYdc7jT0aUUV5TeuRQPbAUGVHUeOz6MFbm91qhJlYrSScZ6xjXLzk0S3H3DCpF",
    "SXGY5BxsWvfNQIjU+PXifnYNBtnjJP3UfPyQlmyEtpAmB9Oo0fdBx+Ib8Lwn2Zj/4yLq53ma9b8AZ5ZkaRCNtHKgf3LaPxmgDgssr9iQapMrW0TmuZTbOBkT",
    "BmyRjvkkSfkYaph1E6sGEMbWslk7LpcNa0VJAadBLJn6Yq+ZKUmnSfrJqL/ExyL5D2f7bPe1q6h45EpPYMTKsU8PODR+gdHpx/PD05Pj39lX6+PJ6dvT4+PT",
    "fwa2IpinuAbagbA5GZPZi/JozO8EqcOpwF9fv8q2UZJmpAz+MmXmdsdC/NOULpIxKVwkY6P5kzWclUR6Yp+fRTHZFqZSB6h0nYxueLlIxgdRM3g8VkvZErnu",
    "juVDCatklC6rFw93HqVdqrICURiam2JaXZfOymTG3xe0gvxkFkvUHFVrqk+6DlnPRy+G1j6Iy+GBiZtQS0RCfr6WErYQhCgaPGc72Y8//siWoVxRoXHwEo7N",
    "yUbHIhtrxgjXVqhlNLjCQnW1iT+VptsiPks2SdJ4Or1nDziwiUAwTVoC44iL+y9UxPrevUlK0P45V26c3xRt4n0gbVi28RsJlpoU9RVuNm6SshGyyyiKABKo",
    "5djo87jNxFXD01EG1x7IYuUEdI2ACRmonnd3dnZ2QvD2Ebd5u6JnXQbCsCc25mETE955/+z04mhwev77xw8n3d+6R8fdN8eAObgWhAVRrFQPWcPCWRRw4Uqo",
    "14LiQKTBF+nx9h/awerVTih8rATTI5qvOea97vn5Uf/cdlhR2szyFg46rCqo8y542bxEjIiiiG5jyC4b42QyAZVEq5VmLf6lbFkfwL1hlKV38kM84y3YZ/zz",
    "Pw01UyxsDIOomE+Tstm42mlIvYanw2nRAm6lECCz8pbn8jf/grIYOICCHmEse6nCHUaTZFryvPlG+BwFwTAqsrxsBobjLW+JVp36hK1Z1uPTiw/nfcuGKxFH",
    "wJzFc4QOquEKKyrZugiOrWBbpTRglDTCiZVoJS7QpxDQ6gH7kicJuOyjPPHobpTbYrVEOSGeUaUPBUodUc/yLJucXk+TG+GK6q8/m0/5itpKN+Rv9JtwaE6y",
    "1LT0UQvby0ytR3OOjuBt4hQeupMPvXMO2uuWWTLnyqEXFcLQQUQcoLVntkKqZ7r+QbRiJVcjWPfD4JfT86PB7x/fH11cHJ28s3BMXBt67+WgkrGeuD3h0Fzv",
    "dbtqnJZXVFNwanebQqmpBDoTvJgcWDVI4IPorQpwL4eh0OoTPBFr41Be5aALd2blBFUOjg932DKgGEewRTiLoG1KRS00K6EZkgyocUS0C0kTH8hAVDW9u+JL",
    "lpMyOQ+8645KPivabFdas4kTlRAwwXUGmLhFITiK7FMDlVRYkEDjg+hyZ8jatkSB2I1gDugJeBMXyRp6+c/T81+du9LjOGk2DZ1lrU0LyBKj7yxIMjXLWnWS",
    "J8tgtMAivOBnhRQVerPPOsqd5n7O2+xSWz3wbxp/YWmdcfBgO7zjeYHn4rKx2xiGyidLefJSiOs9eYf6FBOH+za7tD8Mw6pjv1VJfhv6VsmqqD5W+hXzs4Hi",
    "p2HI+DS5Sa6nXI6NuuYPQ9fJnlTQoxLLHec3vCSjch3qhyGLp9PsMx/3jJEeRmT+GmK8E/pnHCaFsm3Ckmv7FLIoQ2pZ4WMS+iP9LcgmJaawlV0XPL8TdO8l",
    "bLaCoCKGMPAFWs9FLE0rHt+BZWasd1KaP3he7WkTs5q1WCS4SvTpWLlhhKImcCFZDvvXKO0SrChX8m/aGm6M4X8bWlYtafpF4xZAW2fDgg3B4KLxkfCauT83",
    "bk2Xjl+T7Mpt0YvzMUgnSXmvTpUx3BnrF11KYzNbGwwiO1XY1tM3joNBQCiBxc2TGxhMKxnz2TwreVo2rHNVC2CS5dfJeMz1PNWozvl8Gt+vqM0SGpu2prI0",
    "kcI1NCY8jtOCRseNW/xLPCpb8RyU6/bExDmZ3sB1fDuzllh/3CCSSS1yBefXtW3B1NNSgVhqNaWg65cidhMvk2LIsokyYHPQ9POiqQh/QMXuZxitQOMkmzci",
    "dlKHoYQm6AQjToJAShFCIJUdym/rtC6nx0e9321pbGkYTY2qoPTadEwNzwEQJpZGoCUdEtQjxZ1N1CKe0boj1R4F0o/IlCifbKEbrohAdpySEIaoPcrtYg2/",
    "3Ov1zwbdk17f9pfQKhK5gi5Uoy2xo2MrKx4IvnIrLiCKWHMqGMD4ZppdOxxmJTjlLM9mScElt7FPuBkdVWEHvQgf9JDdxsUtLTwk0S96fa0oCbbPfth9uZHG",
    "9bzfOz0/tMRYFXG2SD8Rb2PtVa59yknUCdMhG9Y49PcXHfZqZyeQQIXTtuWsI+qFuj5WD9Z3JwFWu9t9+VNgKb8/iTg0i55cT7NrjEGDJdaRZuwFa+DXC+Gc",
    "KoFuI0zbFwrYR+ARNQ4BIDWLUK+hHGXNVAEsXBqLtGzbE1IKOh35dpdkwLGz+HOclJVoWnmuPvF76l+mWmmj8/PnTBA9VRTKmQQboYpt8XU66Wj7oBhiJbzX",
    "jFH3qkigPKmwhHDQnHMGk4VjhgES1kmDBkSiV+dsII6YpEpQaRPsBkzDrYCQQAv/qiEU7D2o50c8mTZFE4kiblSFLX2t3Lun4Cf2RsN0hIQGWvBqHIy4VNAq",
    "jB6bUVLgvxtFvEgMsK6DymEQncWFK11VIrr3qeUQvlLij0RPODxAiTwsUCIW/ztYavThOEHbV5QUyLnzXAHDLQmM1UCuBS0VSyKMZw3Smyj8WRhhrG/7bPf7",
    "3V3isW0voqqL2BXQ1taxhm4Rd2ZJ2tx9+VNod9KicyQzsGEV2Yw38TdGU4jZib9d+z9+pQ4AO0/aaBO5s892pBOJvZZizZ+EQ+LIUYh71nURRZE1f8AwbUWw",
    "uShzn4r2/8qStNkQXcFJ1rFSe8TmIHU2JK5MgAmgo8GeNtxsaB9wJqk9Y+wrXnQr3CrkqGG7nJue1kI69ugFtsOYbG9A25MBGGxbwVzx+NycTbfUvYKRcr3v",
    "SQViLbHsIjWVDpO8vEdNPdEUGwOK1UoGVvv15LLQaBvqaqwYO7idzeblr/ze1xzUY05jogZXjjErwH9WqUqUGLyirlFt1uu29yxVvxRWVzZwrAOyyRvPzKya",
    "loMnKNwADyH8+WdFsDaMJNm39xPdyDbcfPSOIdlV/JYFG8fiJP9FxPEftLVHnLar8DEHW3uWi/NSXQB/bVQIrawcj9EF1jgfm1oofJhTeyZc32QiEuvA1nq0",
    "2scRtPLE58mCTmkCjtruIamZtlXhRimjRKwwdTYmqrP6Y2HTAFMwqd11wS7rgpR/KS9KPlfuMT7jEx+LpaEAraV1UEN6HLad9fdYt4TzM0S7yIQHHp62iO84",
    "Lq9rnRCaw8ouEO4W4tstGdLgluYxbdFUgqX23w0FCpPJw9hNfVKFckGkwoBmOEHqsJklVS8InNgZ7A1MbQrQ45hJCSCiWCpuWEwYRD+v034cnQz6536JR3Yi",
    "bkcx1eoFae5EWb/9smGcxVaLSGbVwdkhiiL5IbT2eunENhrvMQwpf0QPK+756jR2G2GFCriLWx2oR6grY7At2YYeg+UPspO2h0vZqz0mbCkPJD0gBq0ejeuq",
    "pev7qs48ylyqlpE01JfVcpes9QSG3JG7VHebHhYid0kkfrYpEu82CPf/2MYvG0+dqnWgtb5RDsM61qFDD+2qpKwC3cIP1DdUMW9f4orV5Z5NilfDQTTdp2SZ",
    "QBFiFoBes7br2G+M4qgcSylEmw86GqIiSYvG6h4NDDz1SQct2l/32fdbfgFZVHQvXwLZLaIis92L6kGmgZPXLVZ0Bo4n9/tABEjYtZ8/l+3lxW4c3E3ALu4E",
    "4Tif4i7kQ+rqAXzCLaKJAHC3VaQ7p6ys5IEV3tmH4taqI9HR9p2V1q7HHBEdmuTnmb3wLx55fjx9XDhHSlstxrOkLPn4qV3I+DNfB3FR8LwU6/1GBrg11ZRC",
    "e3Jr12XDSUkMEkPbkAzbWcpaKqJtt2HpmezZHq0iH+htS9d1A2rDqo30YcWopmq5e0CrNdShruthFWnZ8c9CyjD66ieKP5HkrK5FSAiv/BS4jSVlsaTNUEQ7",
    "++XLdUij04bUyZyrkSqsip+qgVPAlkEVW7xaAbL9/gruoiCnKxqEtpivThAlxWGNPkjX9RWbdapRZOjW3vLQ1g8QDylwr8bxm2NfX5UkiVl1cfzSPTk8ffv2",
    "I5a967t6U2T0GZ9CxJphG6xeXeftJ/emLalqewSjs3T0iYIEYkwUlfnFrtEgK6P1AF99WrKsgOsqBLQVEetUMY9RwzxKO4FR11RpQGbtapOyz16NU12Qta2J",
    "8V3gG+tnN6D6e3/5cnpvEQ9I393q17XWKMmeoqAkYelycesUinZooYWTjvamXmQN2hV0lrGFm7s2Kn7UVlpTgTDLyvPsM2h1EFYksnNLT3iI9ACP9OxzVCxQ",
    "JhXxfHbGU8OfSmDqroS6OxUBWAlQmJga0qPorKLo/L6e3tT7mWC2Dsy4IkZrlpnmfg3ZpyQdt1kjyROMt58K17SGlRTW4pgfu0LqNwi+2eeIpKHF4CvbP4iw",
    "Z2TxdFwXfLzcGT6LhFbg1yQVITYwCb24cjmdZChOUyeJyUjkHK1bLm8EjlkZGC9dELQwrl8OjBgsTIS8tTzSau3Lx6sy2IDLlDVZMSGcStNBTAgMAfUKOBZK",
    "51r4SXxq5Z/SBxf+iJPpIuc9MDSga6KfyDUEW9DwUzZoSHi5U/eKgPJ4Dk584P+pr4KGcYBCRK5OR88GMDew2feVTsYOIdEJpur6IaulD4fMULW2rbO8ZqjV",
    "5MQbgDJbYwBpL6u17Z3ddOYCbuYXZ91e/+PRYf9kgOET/fdvUIn7y+n5AIIp3ncHvV8aDs4pOVr6o34T9VxHI7yYElANkoAtgjDViDCiiAxAEADjACbbKGIj",
    "vRfcz/vsNWYWU/FeqjwwcZlOE61nUZ/NQXcuDSEN6PG65MMhdmL3vdswk/nFVtL8QIc9O6RdOdoIFJIwRFuKMKF4ZwOopVB8EY86E3q3CxkIMPjupQm8ExVF",
    "ZgUEsS9jPUXMLn6C8M/X4PMms3Ts7LilOzsvZekami/aOKRecKCMbBfgh8ZKvSSCjOpVMOQzt/I8SMpIMi7RL5DODv+2kzJZn7AOTcLrrP83Ujp5StwlMpGM",
    "1R33TFHv/h7NarAm6QVNeFyJyFZ5RSAqW5aLBOZ28kD93fF69c9HZ8BzI3qlzs6daHXn9ER1bDL839MEty2wPQ1VnLfbu56EJ6P9gcpoUzfEKuqsH6OFW3qQ",
    "JgebCbiX0eMy4L65aqQQO+9xrdbdEkLtDjoILKVRENScWJV4TIXMi9Bv6TbejEN2jWxXLHUZkUjQko3iKYeQgTjnzWtaZty4Fd0Wxx/PPP4EcDTzm2xmqLps",
    "QLKQyi9Iputh1Kyin3Brzytxd4o/4fZMx03wwr+HLvDHStgEoHRmuTA3oo5UrjAHUaRu5WJoCURrWH23k+g2FlyshGZW/5lx0kLG3r3ihPBmvLnEB3etrBjO",
    "WpnbOkdVRqiWjbXO1dYqdeDmPTicsNuBR2OyBvY6XpqSBoGnMhxIKFNg7QH1K49TmciMcU2qvfVtAx1DaiR+r3a/XtCvd+EIvc4zlhHQ94rBZso9n/OgaBV4",
    "1fZuXeEgYmxttn1wA1OixxaotesVhbhW5dsd+BT9jtVuI2vhzmaqTox86J5bygf5gkc3ZSIMCnIs5RwlqOspZ0IDOMGsX2oEIcO4KVbGyRSqQ5kMXf4PH6NL",
    "wFjZ6gteYgZDok8C2FyKdNhl00pBFTJQ6vnE91CHs9Yjj0ObRVqWMpPu4yJjhkviIp6OJYdzlQrWRmemlex/4yoXBYoi4xjJlYN/6zy1m2zGYf940PWGG02n",
    "Jpeuzv/a2jUpH1IzhXg61VKQPQpiuZlOJZyWNUwrsgtLdGCXRlOR+UXsTAQvgBFoMCoboPA+xkV8wfDfwMqnuIknUu36WDSKhPEJVDqTPN7GCsrQkyKziknK",
    "awdKVf6Qqpk8NJYcrxlGJ+cQz23ti9xkmi2wcl8Seznp2si0OzSiz66DV7TqQuy9iKA30YCbrf3Zef/ovccEY/yuliJL27uktPaikPl/4nSMZAES24hwPeH9",
    "Kl4Fuk2KMsuBGLObPFvMW+i1xa6TsohM6LrgoZgnV0qZc67TrVSWvUfyr4T22g6tXNnqjZmmyFv+dXdn58cffggYhKIwJxHNVdm8/ONqZ/giuNr5L/WYDA7R",
    "UBMBUb8U83Jo5xKdu5lOZyrJEb0Y5BMvuzLpvxiTlCGbTbstSNa7u7uB5tCfvrd2OixvPqJGcZt9rl9wOPH48Ji94iq/A8lgtCJfkZtCTfr8odKHJqGyV3b8",
    "CLLimz6lLKNFDmnnJFEhOXX/gqQajzCF1CTPUMPVyVqc6tQDFjgKYYjpqGbe1C4HkamqFl/VFykPkmkl30ukkiHgzmDSe2C6qs3sVibbDOpI4hHkVGyZ/rW6",
    "1gcJa8f1vRswB6Su8IexVDIqH4V4ZrMtRtEwiWadrCNC52G/Bfn8uR6iglajNd7wmJqcOEcn3d7g6Dc7hSbJ0rPi/VQt71fypvjxaY/iI2KV7y3XZhWcWWpM",
    "zOPdLTUoYqd0E7YUNaHgOBpbW2FOpiUSGvlVAHxEAPhmKy/VbzWv2Tbpc31gvIJMgmrimJB/ykm6QTdJljGgTHkkiTHxxN2AupF0xR76vuppMdNnhV8OaD6c",
    "lc/xyslgP3Tmf8roH5T/jXJOiaLoOhvfs6UKxbT2XiX9waN+x3PIPjJGR1FRPOOgCa9aLK3Sy53hQXQjER/r4B+KNlTrKhqBgqVLOLwtfAdD0I4NT5E9GJWR",
    "+cLkTUeloc4tZSdUF42qvgG64ZykVK9UrnjLacQn1cVtWFkU+Z0sCiFFdlVaom8ER6AHTBAvdgL96MrkqTIISr7CglAtJKpAM+kI1gITIg7CXHF47LXLVJpu",
    "ya3rv4Fl139En7TlKB4LnDVlxfqNre/U9W34hkOp9b8ST8mTAXL9BBOEazOJ6SsDvgwZvmm4qimhD7pI43lxm5WPEPVqVVQQOKLsyhWPldAO7jrJ0pPFdArS",
    "TNV99pLq+RrDfcHcrdClyUERT8R6D1lvlQuPL70Q+nw+O2p9AgJNWHFM+rGARqVLNp+GslI/cTnTqKIPFUipB1wprzu/go2x3jMneZ6aj/QRcgvAZksVg5EV",
    "57rlc1ZV1CespF+0u9a8diXnV1h5HDt4NPfneRCH0F9USawUWcKqS6oRG2qaSJFNyzX2K+PS5w5+q1ecGyQJZeUpcU99jKmyhaLKm+GeZuKdcLYMhsQNSE8L",
    "ZCCyMug5JOdpH4/KgtAdpl8rieS82fb+jC3NIbvVCB9YUHaf9/FcRzUpWrnfDJxEUMKYlU3IiRM2BKUlWqMpC7WHK7WGUZMxWVJxZdHnbTr7dM3Vc36Y3Uhr",
    "tzymuic7ypmUTOUCozM8N0m1P5rSYUOTn5XlXvTmMOToRS8KcL7aPEuemTLvxygCY/CnklTyGbKJ0ZiDTpyno0T5legvaFI0fwkuAdVEaL3XHTEQR2k9yAdU",
    "ayAmFcn7I3RqUr/ybeKT0B9Wlf90celNB8YrZzPFOJ7pdwm0L7jUc5shh3QXNsa3i0GN1tMczqjgJe0oEl4D5It54tacUnpkIFqSnCk7uEk7Q3hCsdCy7Fcg",
    "rzqD1MlHgodbv9qiit51YDWqE8+Eb2QmpY4PtlG5E9T0HgRMunvziosEYV9oaxW2cR0X/ILkPVs1xzWgRHqRJL2h8L55DXzno26nQu+4CKsPht8a8QLu1kDF",
    "nDjHqoLtq5Crfpc2AKZx2IYCn91cgSL/KfWIID5HqAiwevrE74tmMLSSYGFSerwxfInqa9XagZd38Bl5XBvPMzlqdLHQcwUrvxzMpg3W0K8PJ+f94y48oSgY",
    "i4Yn/y8z2vIz5edTaEEEA3kKY7JXRutlUBmitczOOPe0wIPrIddV257cFx2xkmF2mh6SByisur4k6ILpcwOXF7qUhfGoxJSYdKwB7VRgoq5cdVSxgrHA5Ecb",
    "CxVHU+XXpy5OXt8muevqPHhCuGrwwdB454XewM1SbIV+rGQxSH4e6TDjiwqxmD7M7l/P8+FxNW4kTtYDjBq0Anv+cqn9T8ipQJMpSNlDK9r/SgmVuLwWxYL/",
    "inkcPY9yiozDbfAdQiFJgmhhq5YwugoHeEBGTJ2uRCj5QRrWJNZ/TsrbnsrNdJyNPqmhy1GETGxrs/L67zQbfdLBxfEIExifiRzQ7xclLoyGV/vElSFNKm/F",
    "N6foqHENcpyPapyC9DPz8vZBmmYGV10LO8Hupkk3QnfiwdNytNDXjQX3KEYgekeUvoACYA5SuhOm4TdEYln9S3XH+sMiDTv+I2AWtLJBStdSq8r5JmFc/Eeu",
    "FOGEkE3EykoXj6JJAlrVSIWnZ2GMi3OQtnKwODx/ziql8EKdv0QaZxoum+t2lcj0aGTxpLjtLulGK3Lef386ANFn0D8ZfDzrnxzqdzjUf5BPUCRP92U3W73h",
    "+xSQyEMoQG2MKrWzlhkHNSbq1IWPnfSge/6uP0B+6uL0+Le+Tmao/tveZgN0apGvEgpym31OeV7cJnPMu7soOHjEwUuFCndDk9NOJWLnY0WZIxv+CU/g9R8W",
    "mxhRfQOl8GQWJgvjafk3cNObZSU3bD07OtR8blIWcoEjB3vkV3UPdKidRX78kzBGLZ0mp/KWoOS0qev/b6rK6euKJPOBGiDNEU/eSLD16DacQtokWMdnpAhZ",
    "3UQshtuFqTDAx77gJVmXP0CNxvJR0/viZ0J1G28egdo4Y9XKnz+A9kmTA6zI/LB+jwlC17l7r8MCT/4H00SK/kuXD/DnCKnNQKdqO7sK3sI+prNTEcOI57Sv",
    "Z0dWqxnrxQbJ8mBIzii1Kc8blL8xg1Ybi+9N4PFYRHj69uvea1bWt3wb4MzadBtrjotfGtONPKXuvvtSG9Xuu9yOYCP6bPhbNZ7wW0hd8M2Mmm3ZIMn1yPY5",
    "uP2X5Qh8SRB6o6Nrx0B4sc27lW4ORGZEXDJpKdnC3BWC0JcuxTKA6IapsKY8wtDJpmR3lo5L5DzPSuQPjFrHyO+SOaH++g/+R/ekh+KB9ZTYUrj1l3lc82Sm",
    "80yk/Zqj0gYKAK4+SDPvaoy2rn2dzCMYzop/nNWFDDTIJnYUWCAfRozHY/X2w9zbXkE3ELQBlMJQH12Fvgovg6U0Igk1PID2KJugDotWBs3Q+IILHyqrAA/H",
    "BS+HtH/SrQWeWKayCXM7WGfdChzp2WvZUu5MLfVkCXrDrK6KK+kVoNAGWPOguW0wC+j8nSIDT1ug6q1ytcNVm9p49HO9irVWqU/N657yJeo/5W1PwBmEqqJC",
    "nvjOp6MRlHKxoL8q/TXdEYRGKYcmMiprtxQSz9EGE+Jztt684uFG+bCJvlCmL97XcWhKa6b+XaRJ6XXxA5KmQ9sn8bTgdpYaYaqewhKhU72aI3XrYB3LGWfP",
    "GQN1Z7zoDwbH/UNELneMxpOKnEHyDJYdR6dcX7wzVS56dKZnxm3P26bWi09rjXSS8Xq0vOgf93tVC9nS8gVV+jXLoL3U3E4yA/RrNiLlSjKaJqAZKQsBzFXT",
    "UTC1byuGlbcBqZFJeJv0LJcU6jFEfGps/3HiP+NxOrGv0+qgrJcvLenVK9NqTe8/lVpCTdc+RibIjIK0HPiRtFOjgjAL+/DiuuqwasMVNvRTpc3AjPgV59zK",
    "gXZygNSW77PvX26Ceb3uyeHRYXfQJ+lTbNTDJwlZZ4PRgwuSWkNsFSn7PjGyiwKZhmAjZ+/3/UH3sDvofrzonZ5Z5j4B/o2M4qFRe7T7kDXAEv76VUO9c1/f",
    "AotJA02UTE/E41XVwv2yZqyeqd+gBdZzAhBJd1XgJB5X1DY9VeBuoiSuQwGVd4q+8wD2mQ2fdWjKIHg8xGJIwgZJJkf3QxW8x3QRdMLwRdakhfqDkEWUccF9",
    "KK/N5lHlZTjJ9msiIt74UHjhuewrt45oIZ63QwcFTT0sWATzhTRJQhBozWoQQm2fa0TJ7mDQf3828LndIbU4JCxp3RtwNjddITKOE0/9qs3t5ZFn6RGBHr1f",
    "+r1f7WeyrckgySdLWhPQAZnTH2qfY9FZQXsuqXcr3unXqXXMkb2cDxLfVcyberlCmnfEkCNnIMLe7XxTxJ2PozXD2/wO8qXtVp2smVqw4T4R+sGq+Kbfe9qw",
    "V2TBa/0BjRvGknqW2mGa1YjanN+1EFswpraFoTKYs+yXfvewMQyiMk9mzUr6+DqttPXi6RNSuYfO80lzS7lWjfOteybJ7+ZT8e8RYOmrSfUMtakVVp9Scpup",
    "Z8uj6uv0ziNLlVCWugHAfU1eX/LiuKkg+6Lndt2pqPCAYf17TDb/U1PNfmS4TRyt/QIHcsubONK7LjAUdIUP39SVe7VfjQt1E/cam1vwCqQgZytFVvVmUcJ3",
    "WHVM8ujlQnYpCdvDWqkhlLKJZ2ZsGdaAcffBAFmxn/XgNjozqvkwZJd2SrGVbEjoHZJ2GKwstflKKe4wCO1kdPM8yejTKkTxTJ4Mgjr6fYXKE8xYHhnPe5G2",
    "BrxRsaA+fYxbR6WJWcMBHZ/3u4e/fzzvD7pHJ30nnQPGs9mXRrKJgYvYQUUF+4mnUKumPeYq8VJWSN6t2gk971SBclg/QyVamLemUMsiudaq22HVm5DqtsSU",
    "l27SI5+Cu/4NLpothKqdlc9lNhGNq/vv4QztHCDSiZ284r1SRXh+Ouj3wAP06OTsg8PpLuk0a51AH+eAV6eXn/wpLp3UY3fMRHBlEd0geTQ+kNovV1VEBhF/",
    "esLYbDosR3Rk0t3R1tq9fSd7/erVOp8sb9DARLuZWn7KD4LE4BeTtss/RJTm6AiXrn0DlxF9kxxycRCJjTg4YJD02AzGWW8X4IN8Ty8UL+axpYFefcbGG7Zg",
    "tkpAosGc3jiEquO+bEhF+zVbQPzpe790jype9Wb+lUHJLVF6EbUjsh7RGGjDWwVYbq6QUIs7vjIHuCyDU6EIpEgMiVjn6Q/3RPnLw2/3NWlgJCa2i7JN4+oM",
    "pt/mjevmbntCQOkm+d7wFa4Vca0Hnr4seO7LHsH/YtSntyt/AKKvMzt2c7OoxP8f42w3UcDWWPwrwSA9HdFRGxNSkzhvMo1LuJ2ait5BMD9cRx7yUD3IQ8mK",
    "R1HUtLP4ad0WkF3WZpdWceSB7q1g9UVjWEBXCmI067AnhKHI9fIFbdjWiydHyjyhZ8MSqcmFzjj+8uCXykuhajft3dGsvbPZwbqQFzQRP5B3s3w1V4d+1GIQ",
    "EMWVVQkuBdbjXZbIqBrhrTK0lIo6k6JPmVk3LMG+WkmeDeqSKdfHM9ZC3vO+BLd+cHQhyOgENyIH9wg2w/HAVyYAejfSqHqD3PawVEYM2xVLmfTrxUBLotj+",
    "w8lVp3O3VwBE4qXhdbrL7vn5Uf/cZaOE17Y/NdyM5ze8BdMUOsSkaIGMDl7zDc/7YHIcWsVo1AMkTVxRjpOszRrzBHOpr8ga9/qHH75/DRyT9IvYxAVcTfL9",
    "KXH0XlafbV3pDLzhQzjKveBRCURoDJJIokHMuUlawCnSllwyMHBpu+P5vRbCHY0eiNWKrbBLhpYJSLqTYUYu0TvN5REqP44xraC+KWKpC6y4CIwOasXjO0AR",
    "kd3mmeoNfiso5jUGLPM++0fWrEWG137ZoC2zRTnKZk7WN/nRAiEbNCpdQxb8JL3pxXmeQC43VKXbnKZ1GboAatSjytJhcWhqe2raDANran5biJP5zB1ObSvM",
    "SHXtf9TOY8HfDB56fiXjisOMC0XpuWPIv/cuKQ+TyeSg4gKwqjZ25wuZ3KQrkY2LyHz1+gNXON8YvGWxfoR+wggQasXl0bIwcjVdh0iNd+eKbwI+G56N6QH3",
    "VDGKqly9hWE2q64V1B/s/9QAKgVg9yBtZgeVAVcBfbfAYU7tJdH+xcpqp8mw8soWSdeVPXa/MjBZFOg07I83JtrpibX1zbfkkpxKffOZL8fwkTzhj9iIDbFJ",
    "PzxDNsPXa52NmhB1GPmByV64VJNQb5BjT5HTQIbbIWhx1Wz/cRUtisnVtuS5iqttcgVcbWtuCtL+YsohzVD5uwj+lIVazc36OyZPK4sEFxUfC6ukssb29YOp",
    "7yRq6wTe3zY1K6re99ikRc1IEVoDZkmlikPwQqMja7NLB6+EDl2tAKYF0HHqDpc3iuflIudP4e9WKsYU51d9bZlwd5tHBGnryWMC1cRBWREtoSRhHSrhN+fo",
    "YvUiIv9SUj9f85AnnYr2iDudi4Rl1oOekEYFnrmSjrfWe5VIJDHAos2IMNXTn6HzzfouzGoDc9LU2jblUUzgX6iykKlgU4MGmZhEe+UUyb5LWrUvjrnQQ/1f",
    "9C5feThNub4ylCeBfM1hes/K25xbLzkUJZ9DynZ83jIGpTM8AJVTcsmmWTbHFx783t5igx/l7G1S2NRMtAjaW0xPUlA6CNhB/+g2a2iFX2PP8utQTkvUhUJ9",
    "q3GFslNBrHXkhgjpCcSurrEPyzrknrXeGN3eZl31vqUcLLyzIdLm34sc+jHmXI5TuPZvptl1PBW5GLKUTRZAy9BxIxLQTvNxksb5vU4XLpTwmKZfMeSYaU8h",
    "KWzdDYiRKZvG4Jk6uh+BbpGO32OCtmbhVvQ9Mo4KLKzjtQB07OecH5zn7VU2c79dgMIlxifT0GhT7D2ryVliQ1R/uVFuFT91UR390rGFwpNC0ngCZq9W8WNQ",
    "RTUTQ625t5wgvGDDC8BURqMgjDJJx/yL1oUqc/2e/P4z+17+fPHC3h6SCUKC6HTYS3ZQtWiwtmtSoTo+ES5DYOyyA33CQVHC8MAbqbNBWysS6s2i4j5O5L74",
    "EyL9a8u+l/YjfKApPROpwBvATW5rAlJswyMITRPnQwd7wBqY0NJ8267MoKXdvbbxHRWd8kC8uvIjsmZCVysSYtKBkYRfrG4IJEeYIpWsbX+Vo7FSLk7hZr7v",
    "zufTBPfV/4TRlk5A6GFj1xhEAiv1WqfT8TcgIvrje6sogtd2VzHUEtWxvSgmoE2cTr2kTWNVVLsZkuA3xQX5V5QEFROOSNyz0n5lJaJ55FG3M7g8xmaySoNf",
    "p7knWUxEjU/0QWhjIpWlMlymCNmlm0xdqMGeqVES6Mx6ZWW1awFW9Xwmc6iim3EdFsDP4JLOUyEjVlsFa6pWECx4RD9WNvNACrjqoc6r7eZB209bvjp0KFgp",
    "+PrMSRbKsY1tJ/23b/u9gWtcsDOGEEKrrXGOc0rbr+qQZFkcbRMcr7PZUksXPflKXm7WPMwGb3+L4Hdaru056zQ4q4xHMhGBR+RTo7Cm4RfOquf5CURAu2mq",
    "y25pMnN6Ld2bT/rkdCDUWCKJld73R45SXkX+O4i8RO/JLy/arLt0MHm5XbV6/lGvsq6H2ovG00WVAmy8sB9Ozs5Pf+ufOLEgGzwLJJaqjknwvBB0UcY3/CAy",
    "9SL1qoZ5dqfNnvBUkCElm84a/FnfdHu/fjzvv/1wYdBJIKzvLBlPU8HPvWC7Xo/TWrcRvcGrfFIprytP7brzunwsby6ivVd4JD1yz5RpYY3j0eM2dNVGDvrn",
    "749OuscO7uqEFh5BPrQE+YrLkR0WIYtJIERVvPdbQIVu8H8AhHm3isPhAAA=",
  ].join(""),
});

test("native qualification snapshot preflight", { timeout: 300_000 },
  context => runNativeQualificationFixture(context, true));
test("native qualification contribution completes current capture and certified historical repair without replay",
  { timeout: 300_000 }, context => runNativeQualificationFixture(context, false));

async function runNativeQualificationFixture(context: NativeQualificationContext, preflightOnly: boolean) {
  const work = "urn:usf:work:cli-provider-qualification-help";
  const profile = "urn:usf:profile:cli-provider-qualification-help:1";
  const manifestPath = "graph/manifests/cli-provider-qualification-help.json";
  const validation = "urn:usf:validation:cli-provider-qualification-help";
  const helpPath = "src/commands/help.ts";
  const acceptancePath = "tests/fixtures/cli-provider-qualification-help.acceptance.ts";
  const wrapperPath = "tests/fixtures/cli-provider-qualification-help.test.ts";
  const acceptanceDigest = "sha256:0420c2dd2a40ccecb3e0d9cb2402530714399c4db4eb6b535c9bead2872acb6e";
  const carrierOnlyPath = "tests/integration/linear-native-completion.test.ts";
  const runtimePath = "src/commands/linear-continuation.ts";
  const bindingAuthoritySource = "graph/linear-work-binding-grants.nq";
  const vocabularyPath = "graph/hermes-linear-autonomy.nq";
  const continuationPolicy = "urn:usf:policy:linear-construction-continuation:1";
  const handoffPolicy = "urn:usf:policy:linear-continuation-repair-handoff:1";
  const fixtureBindingIri = "urn:usf:linear-binding:native-qualification-contribution:1";
  const historicalBindingIri = "urn:usf:linear-binding:native-qualification-unrelated-history:1";
  const pointerKey = "metadata-continuation-" + canonicalDigest({ policyIri: continuationPolicy }).slice(7);
  const predicate = (name: string) => "urn:usf:predicate:" + name;
  const digest = (bytes: Buffer | string) => sha256(bytes);
  const controller = { workIri: "urn:usf:work:hermes-linear-autonomy",
    profile: "urn:usf:profile:hermes-linear-autonomy:1", manifestPath: "graph/manifests/hermes-linear-autonomy.json" };
  const selections = [
    { workIri: work, profile, manifestPath },
    { workIri: "urn:usf:work:linear-work-binding", profile: "urn:usf:profile:linear-work-binding:1",
      manifestPath: "graph/manifests/linear-work-binding.json" },
    controller,
  ];
  let runDirectory: string | undefined;
  let snapshotBytes = 0;
  let copiedBytes = 0;
  const sourceFiles = new Map<string, { bytes: Buffer; digest: string; mode: number; dev: number; ino: number }>();
  const sourceDirectoryModes = new Map<string, number>();
  const optionalAbsences = new Set<string>();
  const hostDirectoryInventories = new Map<string, string[]>();
  interface Fixture {
    readonly name: "ordinary" | "handoff";
    readonly root: string;
    readonly primaryInputs: Map<string, { digest: string; mode: number }>;
  }
  const fixtures: Fixture[] = [];
function object(value: unknown, label: string): Record<string, unknown> {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), label);
  return value as Record<string, unknown>;
}

function exact(graph: SemanticGraph, subject: string, name: string, kind: "iri" | "literal"): string {
  const rows = objectsFor(graph, subject, predicate(name));
  assert.equal(rows.length, 1, subject + ": expected exactly one " + name);
  assert.equal(rows[0]!.objectKind, kind, subject + ": wrong " + name + " kind");
  return rows[0]!.object;
}

function repositoryPath(path: string): string {
  assert.ok(!/[#?:]/u.test(path), "Schema or URI reference is not a repository file: " + path);
  assert.ok(path.length > 0 && !isAbsolute(path) && !path.includes("\\") && !path.includes("\0"));
  assert.ok(path.split("/").every(part => part !== "" && part !== "." && part !== ".."));
  assert.ok(path !== ".git" && !path.startsWith(".git/"), "Canonical Git is outside this runner");
  return path;
}

function contained(root: string, path: string): string {
  const absolute = resolve(root, repositoryPath(path));
  const relation = relative(root, absolute);
  assert.ok(relation !== "" && relation !== ".." && !relation.startsWith(".." + sep) && !isAbsolute(relation));
  return absolute;
}

async function regularBytes(root: string, path: string, maximumBytes = 8 * 1024 * 1024) {
  const absolute = contained(root, path);
  let cursor = root;
  for (const segment of repositoryPath(path).split("/").slice(0, -1)) {
    cursor = resolve(cursor, segment);
    const state = await lstat(cursor);
    assert.ok(state.isDirectory() && !state.isSymbolicLink(), "Non-directory or linked input ancestor: " + path);
  }
  const before = await lstat(absolute);
  assert.ok(before.isFile() && !before.isSymbolicLink() && before.size <= maximumBytes, "Unsafe input: " + path);
  const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    assert.equal(opened.dev, before.dev);
    assert.equal(opened.ino, before.ino);
    const bytes = await handle.readFile();
    const after = await handle.stat();
    assert.equal(after.size, before.size, "Input changed while reading: " + path);
    assert.equal(after.mtimeMs, before.mtimeMs, "Input changed while reading: " + path);
    assert.equal(after.ctimeMs, before.ctimeMs, "Input changed while reading: " + path);
    assert.equal(bytes.length, before.size);
    return { bytes, digest: digest(bytes), mode: before.mode & 0o777, dev: before.dev, ino: before.ino };
  } finally {
    await handle.close();
  }
}

async function captureSource(path: string) {
  const present = sourceFiles.get(path);
  if (present !== undefined) return present;
  const input = await regularBytes(sourceRoot, path);
  const parts = repositoryPath(path).split("/").slice(0, -1);
  for (let count = 1; count <= parts.length; count += 1) {
    const directory = parts.slice(0, count).join("/");
    if (sourceDirectoryModes.has(directory)) continue;
    const state = await lstat(contained(sourceRoot, directory));
    assert.ok(state.isDirectory() && !state.isSymbolicLink(), "Unsafe scoped directory: " + directory);
    sourceDirectoryModes.set(directory, state.mode & 0o777);
  }
  sourceFiles.set(path, input);
  snapshotBytes += input.bytes.length;
  assert.ok(sourceFiles.size <= 2048, "Scoped source denominator unexpectedly exceeds 2048 files");
  assert.ok(snapshotBytes <= 128 * 1024 * 1024, "Scoped snapshot unexpectedly exceeds 128 MiB");
  return input;
}

async function materializeSnapshot(name: "ordinary" | "handoff"): Promise<Fixture> {
  assert.ok(runDirectory);
  const root = resolve(runDirectory, name);
  await mkdir(root, { mode: 0o700 });
  assert.notEqual(root, sourceRoot);
  const fixture: Fixture = { name, root, primaryInputs: new Map() };
  fixtures.push(fixture);
  const directories = [...sourceDirectoryModes].sort(([left], [right]) =>
    left.split("/").length - right.split("/").length || left.localeCompare(right));
  for (const [directory, mode] of directories) {
    const destination = contained(root, directory);
    await mkdir(destination, { recursive: true, mode });
    await chmod(destination, mode);
  }
  for (const [path, input] of sourceFiles) {
    copiedBytes += input.bytes.length;
    assert.ok(copiedBytes <= 128 * 1024 * 1024, "Combined scoped fixture copies unexpectedly exceed 128 MiB");
    const destination = contained(root, path);
    await writeFile(destination, input.bytes, { flag: "wx", mode: input.mode });
    await chmod(destination, input.mode);
    const copied = await lstat(destination);
    assert.equal(copied.nlink, 1, "A fixture input must not share writable hardlinks");
    assert.ok(copied.dev !== input.dev || copied.ino !== input.ino, "Fixture shares a canonical inode");
    fixture.primaryInputs.set(path, { digest: input.digest, mode: input.mode });
  }
  return fixture;
}

async function assertCanonicalUnchanged(): Promise<void> {
  for (const [path, original] of sourceFiles) {
    const current = await regularBytes(sourceRoot, path);
    assert.equal(current.digest, original.digest, "Canonical scoped input moved during acceptance: " + path);
    assert.equal(current.mode, original.mode, "Canonical scoped input mode moved: " + path);
  }
  for (const [path, mode] of sourceDirectoryModes) {
    const current = await lstat(contained(sourceRoot, path));
    assert.ok(current.isDirectory() && !current.isSymbolicLink(), "Canonical scoped directory changed: " + path);
    assert.equal(current.mode & 0o777, mode, "Canonical scoped directory mode changed: " + path);
  }
  for (const path of optionalAbsences) {
    await assert.rejects(lstat(contained(sourceRoot, path)), { code: "ENOENT" },
      "An absent optional source appeared during acceptance: " + path);
  }
  for (const [path, leaves] of hostDirectoryInventories) {
    assert.deepEqual(await hostDirectoryLeaves(path, false), leaves,
      "Canonical declared directory membership moved: " + path);
  }
  await assertRuntimeAssetsUnchanged();
}


function metadataSpans(source: string) {
  const file = ts.createSourceFile(helpPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declarations: ts.VariableDeclaration[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "probeQualifyTopic") {
      declarations.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert.equal(declarations.length, 1, "Expected exactly one probeQualifyTopic declaration");
  const initializer = declarations[0]!.initializer;
  assert.ok(initializer && ts.isCallExpression(initializer) && ts.isIdentifier(initializer.expression)
    && initializer.expression.text === "topic", "Unknown qualification help authoring shape");
  const settings = initializer.arguments.filter(ts.isObjectLiteralExpression);
  assert.equal(settings.length, 1, "Expected exactly one topic metadata object");
  return ["purpose", "synopsis", "options"].map(name => {
    const properties = settings[0]!.properties.filter((node): node is ts.PropertyAssignment =>
      ts.isPropertyAssignment(node) && ((ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) && node.name.text === name));
    assert.equal(properties.length, 1, "Expected one literal metadata property: " + name);
    const value = properties[0]!.initializer;
    assert.ok(name === "purpose" ? ts.isStringLiteral(value) : ts.isArrayLiteralExpression(value),
      "Only the existing literal metadata values may be replaced");
    return { name, start: value.getStart(file), end: value.end };
  }).sort((left, right) => left.start - right.start);
}

function correctedMetadata(source: string) {
  const option = (syntax: string, description: string) =>
    "{ syntax: " + JSON.stringify(syntax) + ", description: " + JSON.stringify(description) + " }";
  const values: Record<string, string> = {
    purpose: JSON.stringify("Qualify one exact provider and model for the requested task class."),
    synopsis: JSON.stringify([
      "usf probe qualify --provider ID --model ID --task-class NAME --env-file PATH [--max-output-tokens N]",
    ]),
    options: "[" + [
      option("--provider ID", "Required provider identifier."),
      option("--model ID", "Required model identifier."),
      option("--task-class NAME", "Required qualification task class."),
      "envFileOption",
      option("--max-output-tokens N", "Output budget as a positive integer; default 512, maximum 8192."),
    ].join(", ") + "]",
  };
  const spans = metadataSpans(source);
  let result = source;
  for (const span of [...spans].reverse()) {
    result = result.slice(0, span.start) + values[span.name]! + result.slice(span.end);
  }
  const mask = (text: string): string => {
    let masked = text;
    for (const span of metadataSpans(text).reverse()) {
      masked = masked.slice(0, span.start) + "<qualification-metadata-value>" + masked.slice(span.end);
    }
    return masked;
  };
  assert.equal(mask(result), mask(source), "Bytes outside the three metadata values changed");
  const options = metadataSpans(result).find(span => span.name === "options")!;
  assert.equal((result.slice(options.start, options.end).match(/\benvFileOption\b/gu) ?? []).length, 1);
  assert.notEqual(result, source, "Original metadata already equals the intended positive candidate");
  return { source: result, originalDigest: digest(source), postimageDigest: digest(result),
    permittedSpans: spans.map(span => ({ ...span, originalDigest: digest(source.slice(span.start, span.end)) })) };
}


function fixtureMetadataPlan() {
  const original = sourceFiles.get(helpPath)!.bytes.toString("utf8");
  const synopsis = metadataSpans(original).find(span => span.name === "synopsis")!;
  const before = original.slice(0, synopsis.start) + '["usf probe qualify [options]"]' + original.slice(synopsis.end);
  const correction = correctedMetadata(before);
  // Both preflight and native authoring use these exact bytes. The disposable
  // carrier writes this ordinary metadata file as 0644 before making its commit.
  const delta = classifyProbeQualifyMetadataDeltaForTest({
    path: helpPath, beforeBytes: Buffer.from(before), afterBytes: Buffer.from(correction.source),
    beforeMode: "100644", afterMode: "100644", expectedAcceptanceDigest: acceptanceDigest,
  });
  assert.equal(delta.beforeImageDigest, correction.originalDigest);
  assert.equal(delta.afterImageDigest, correction.postimageDigest);
  assert.equal(delta.postimageDigest, correction.postimageDigest);
  assert.equal(delta.acceptanceDigest, acceptanceDigest);
  return { before, correction };
}

function matchingWork(graph: SemanticGraph) {
  const result = deriveWork(graph, { selector: work, profile, maxItems: 1 });
  assert.equal(result.status, "ok", JSON.stringify(result));
  assert.equal(result.items?.length, 1);
  const selected = result.items![0]!;
  assert.ok(selected.realisationBasis, "No derivable selected-work basis");
  assert.deepEqual([...selected.writeSet].sort(), [helpPath], "Selected work write scope widened");
  assert.deepEqual([...selected.realisationBasis.scope.writeSet].sort(), [helpPath], "Basis write scope widened");
  return selected;
}


function verifiedPrerequisite(graph: SemanticGraph, currentness: string, permission: string) {
  try {
    return verifyTransitionActivationCurrentness(graph, currentness, permission, permission);
  } catch (error) {
    if (error instanceof UsfError) throw error;
    const code = error instanceof Error && /^[A-Z][A-Z0-9_]{0,127}$/u.test(error.message)
      ? error.message : "FIXTURE_PREREQUISITE_CURRENTNESS_REFUSED";
    throw new UsfError(code, 4, "Native prerequisite-currentness verification refused.");
  }
}

interface CapturedPrerequisite {
  permission: string;
  currentness: string;
  sourcePath: string;
  receiptPath: string;
  receiptSchemaPath: string;
  authorityManifestPath: string;
  authorityProfile: string;
  memberWorkIds: string[];
  receiptDigest: string;
  receiptFileDigest: string;
  normalizedReceiptDependency: ReturnType<typeof verifyTransitionActivationCurrentness>["normalizedReceiptDependency"];
  inputPaths: string[];
}

async function capturePrerequisiteCurrentness(graph: SemanticGraph, selected: ReturnType<typeof matchingWork>) {
  const captured: CapturedPrerequisite[] = [];
  const visited = new Set<string>();
  const active = new Set<string>();
  const packets = new Map<string, ReturnType<typeof matchingWork>>();
  const addPacket = (packet: ReturnType<typeof matchingWork>): void => {
    assert.ok(packet.realisationBasis, "Authenticated member must have an explicit native profile basis");
    const selection = packet.realisationBasis.selection;
    packets.set(JSON.stringify([selection.manifestPath, selection.profile, packet.id]), packet);
    assert.ok(packets.size <= 100, "Authenticated receipt-member closure exceeds its bounded work count");
  };
  const requiredPermissions = (packet: ReturnType<typeof matchingWork>): readonly string[] => {
    const permissions = packet.realisationAuthority?.permission?.requiresPermissions;
    assert.ok(Array.isArray(permissions), "Native required-permission selection is unavailable");
    assert.ok(permissions.length <= 128, "Required-permission closure exceeds its bound");
    assert.equal(new Set(permissions).size, permissions.length, "Required-permission selection contains duplicates");
    return permissions;
  };
  const visit = async (consumerGraph: SemanticGraph, permission: string): Promise<void> => {
    const currentness = exact(consumerGraph, permission, "activationCurrentness", "iri");
    const paths = {
      sourcePath: repositoryPath(exact(consumerGraph, currentness, "sourcePath", "literal")),
      receiptPath: repositoryPath(exact(consumerGraph, currentness, "receiptPath", "literal")),
      receiptSchemaPath: repositoryPath(exact(consumerGraph, currentness, "receiptSchemaPath", "literal")),
      authorityManifestPath: repositoryPath(exact(consumerGraph, currentness, "authorityManifestPath", "literal")),
    };
    const key = JSON.stringify([paths.authorityManifestPath, currentness, permission]);
    if (active.has(key)) throw new UsfError("FIXTURE_PREREQUISITE_CURRENTNESS_CYCLE", 4, "Prerequisite receipt traversal contains a cycle.");
    const verified = verifiedPrerequisite(consumerGraph, currentness, permission);
    if (visited.has(key)) {
      assert.equal(captured.find(item => item.authorityManifestPath === paths.authorityManifestPath
        && item.currentness === currentness && item.permission === permission)?.receiptDigest, verified.receipt.receiptDigest);
      return;
    }
    assert.ok(visited.size + active.size < 128, "Authenticated prerequisite closure exceeds its bound");
    active.add(key);
    assert.equal(verified.normalizedReceiptDependency.path, paths.receiptPath);
    assert.equal(verified.normalizedReceiptDependency.digest, digest("missing\0" + paths.receiptPath));
    assert.equal(verified.receipt.sourcePath, paths.sourcePath);
    assert.equal(verified.receipt.receiptPath, paths.receiptPath);
    assert.equal(verified.receipt.manifestPath, paths.authorityManifestPath);
    const authorityGraph = loadSemanticGraph(sourceRoot, paths.authorityManifestPath);
    const inputs = [...new Set([
      ...Object.values(paths),
      ...authorityGraph.manifests.map(manifest => manifest.path),
      ...Object.keys(authorityGraph.sourceDigests),
      verified.normalizedReceiptDependency.path,
    ])].sort();
    for (const path of inputs) await captureSource(repositoryPath(path));
    for (const [path, expectedDigest] of Object.entries(authorityGraph.sourceDigests)) {
      assert.equal(sourceFiles.get(path)?.digest, expectedDigest, "Authority graph source moved before capture: " + path);
    }
    assert.equal(sourceFiles.get(paths.sourcePath)!.digest, verified.receipt.postState.sourceDigest);
    assert.deepEqual(JSON.parse(sourceFiles.get(paths.receiptPath)!.bytes.toString("utf8")), verified.receipt,
      "Prerequisite receipt moved after native authentication");
    captured.push({
      permission, currentness, ...paths,
      authorityProfile: verified.receipt.profile,
      memberWorkIds: verified.receipt.postState.members.map(member => member.workId),
      receiptDigest: verified.receipt.receiptDigest,
      receiptFileDigest: sourceFiles.get(paths.receiptPath)!.digest,
      normalizedReceiptDependency: verified.normalizedReceiptDependency,
      inputPaths: inputs,
    });
    const memberIds = verified.receipt.postState.members.map(member => member.workId);
    assert.ok(memberIds.length > 0 && memberIds.length <= 100, "Authenticated member set is empty or exceeds its bound");
    assert.equal(new Set(memberIds).size, memberIds.length, "Authenticated receipt repeats a member");
    for (const member of verified.receipt.postState.members) {
      const result = deriveWork(authorityGraph, {
        selector: member.workId, profile: verified.receipt.profile, maxItems: 1,
      });
      assert.equal(result.status, "ok", "Exact authenticated member derivation refused");
      assert.equal(result.items?.length, 1);
      assert.equal(result.truncation?.truncated, false);
      const packet = result.items![0]!;
      assert.equal(packet.id, member.workId);
      assert.ok(packet.realisationBasis);
      assert.equal(packet.realisationBasis.selection.manifestPath, verified.receipt.manifestPath);
      assert.equal(packet.realisationBasis.selection.profile, verified.receipt.profile);
      assert.equal(packet.realisationBasis.work.resourceDigest, member.workDigest);
      addPacket(packet);
      // The member's own transition permission belongs to this receipt, not a
      // recursive prerequisite edge. Recurse only through native requirements.
      const ownCurrentness = packet.realisationAuthority?.permission?.activationCurrentness;
      if (ownCurrentness !== null && ownCurrentness !== undefined) {
        assert.equal(ownCurrentness, currentness, "Member names an unauthenticated owner-currentness rule");
        assert.equal(packet.realisationAuthority?.permission?.id, permission);
      }
      for (const prerequisite of requiredPermissions(packet)) await visit(authorityGraph, prerequisite);
    }
    active.delete(key);
    visited.add(key);
  };
  addPacket(selected);
  for (const permission of requiredPermissions(selected)) await visit(graph, permission);
  return { prerequisites: captured, packets: [...packets.values()] };
}

function hostInputPath(path: string): string {
  const normalized = repositoryPath(path.endsWith("/") ? path.slice(0, -1) : path);
  if (normalized.split("/").some(segment => /^(?:\.git|\.usf|node_modules|\.env(?:\..*)?|secrets?(?:\..*)?|credentials?(?:\..*)?)$/u.test(segment))) {
    throw new UsfError("FIXTURE_HOST_INPUT_PROHIBITED", 5, "Declared host input crosses the fixture copy boundary.");
  }
  return normalized;
}

async function hostDirectoryLeaves(declaredPath: string, capture: boolean): Promise<string[]> {
  const leaves: string[] = [];
  let visitedEntries = 0;
  const visit = async (path: string): Promise<void> => {
    hostInputPath(path);
    const state = await lstat(contained(sourceRoot, path));
    assert.ok(state.isDirectory() && !state.isSymbolicLink(), "Unsafe declared host directory");
    if (capture) {
      const parts = path.split("/");
      for (let count = 1; count <= parts.length; count += 1) {
        const directory = parts.slice(0, count).join("/");
        const current = await lstat(contained(sourceRoot, directory));
        assert.ok(current.isDirectory() && !current.isSymbolicLink());
        const mode = current.mode & 0o777;
        const previous = sourceDirectoryModes.get(directory);
        if (previous !== undefined) assert.equal(mode, previous);
        sourceDirectoryModes.set(directory, mode);
        assert.ok(sourceDirectoryModes.size <= 2048, "Declared directory closure exceeds its bound");
      }
    }
    const entries = await readdir(contained(sourceRoot, path), { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      assert.ok(++visitedEntries <= 2048, "Declared directory traversal exceeds its bound");
      const child = hostInputPath(path + "/" + entry.name);
      assert.ok(!entry.isSymbolicLink(), "Linked declared directory input is forbidden");
      if (entry.isDirectory()) await visit(child);
      else {
        assert.ok(entry.isFile(), "Non-regular declared directory input is forbidden");
        if (capture) await captureSource(child);
        leaves.push(child);
      }
    }
  };
  await visit(hostInputPath(declaredPath));
  return leaves;
}

async function captureNativeHostInputs(
  packets: readonly ReturnType<typeof matchingWork>[],
  prerequisites: readonly CapturedPrerequisite[],
) {
  const paths = new Set<string>();
  const dependencies: { work: string; kind: string; path: string; digest: string; absent: boolean }[] = [];
  for (const packet of packets) {
    const basis = packet.realisationBasis;
    assert.ok(basis, "Host packet must retain its exact profiled basis");
    const authenticatedInputs = new Set(packet.semanticDependencies
      .filter(dependency => dependency.kind !== "semantic-resource")
      .map(dependency => dependency.key.endsWith("/") ? dependency.key.slice(0, -1) : dependency.key));
    const requiredInputs = new Set([
      ...candidateScope(basis), ...basis.scope.readSet, ...basis.scope.writeSet, ...Object.keys(basis.scope.preimages),
      ...basis.inputs.schemaDigests.map(input => input.id), ...basis.inputs.toolDigests.map(input => input.id),
    ]);
    assert.ok([...requiredInputs].every(path => authenticatedInputs.has(path.endsWith("/") ? path.slice(0, -1) : path)),
      "An exact native basis input lacks a typed authenticated file dependency");
    for (const dependency of packet.semanticDependencies) {
      if (dependency.kind === "semantic-resource") continue;
      assert.ok(["file", "policy", "schema", "tool"].includes(dependency.kind), "Unknown native file-dependency kind");
      let path: string;
      try { path = hostInputPath(dependency.key); }
      catch (error) {
        if (error instanceof UsfError && error.code === "FIXTURE_HOST_INPUT_PROHIBITED") {
          throw new UsfError(error.code, error.exitCode, "Declared host input crosses the unchanged fixture copy boundary.",
            { dependencyPath: dependency.key });
        }
        throw error;
      }
      const normalized = prerequisites.find(prerequisite =>
        prerequisite.normalizedReceiptDependency.path === dependency.key
        && prerequisite.normalizedReceiptDependency.digest === dependency.digest);
      let absent = false;
      try { await lstat(contained(sourceRoot, path)); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        assert.equal(dependency.kind, "file", "Only a declared write preimage may be absent");
        assert.ok(packet.writeSet.includes(dependency.key), "Absent input is not an explicit native write preimage");
        assert.equal(dependency.digest, digest("missing\0" + dependency.key));
        optionalAbsences.add(path);
        absent = true;
      }
      if (!absent) {
        if (dependency.key.endsWith("/")) {
          assert.equal(normalized, undefined);
          const leaves = hostDirectoryInventories.get(path) ?? await hostDirectoryLeaves(path, true);
          assert.equal(canonicalDigest(leaves.map(leaf => ({ path: leaf, digest: sourceFiles.get(leaf)!.digest }))), dependency.digest,
            "Native declared-directory digest disagrees with captured leaves");
          hostDirectoryInventories.set(path, leaves);
          for (const leaf of leaves) paths.add(leaf);
        } else {
          const input = await captureSource(path);
          assert.equal(input.digest, normalized?.receiptFileDigest ?? dependency.digest,
            "Native dependency digest disagrees with captured host input: " + path);
          paths.add(path);
        }
      }
      dependencies.push({ work: packet.id, kind: dependency.kind, path: dependency.key, digest: dependency.digest, absent });
    }
  }
  return { workIds: packets.map(packet => packet.id), dependencies, inputPaths: [...paths].sort(),
    declaredDirectories: [...hostDirectoryInventories.keys()].sort(), absentPaths: [...optionalAbsences].sort() };
}



  async function writeExact(root: string, path: string, bytes: string | Buffer, mode: number): Promise<void> {
    const destination = contained(root, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes, { mode });
    await chmod(destination, mode);
  }

  function historicalProducerBytes(): Buffer {
    const asset = historicalContinuationProducer;
    assert.equal(asset.gzipBase64.length, asset.encodedBytes);
    assert.match(asset.gzipBase64, /^[A-Za-z0-9+/]+={0,2}$/u);
    const compressed = Buffer.from(asset.gzipBase64, "base64");
    assert.equal(compressed.toString("base64"), asset.gzipBase64);
    assert.equal(compressed.length, asset.compressedBytes);
    assert.equal(digest(compressed), asset.compressedDigest);
    const bytes = gunzipSync(compressed, { maxOutputLength: asset.rawBytes });
    assert.equal(bytes.length, asset.rawBytes);
    assert.equal(digest(bytes), asset.rawDigest);
    assert.equal(asset.mode, 0o664);
    return bytes;
  }

  async function installHistoricalProducer(fixture: Fixture): Promise<typeof prepareLinearMetadataContinuation> {
    assert.equal(fixture.name, "handoff");
    const bytes = historicalProducerBytes();
    copiedBytes += bytes.length;
    assert.ok(copiedBytes <= 128 * 1024 * 1024, "Historical source shares the unchanged copy budget");
    // writeExact chmods after writing, so umask 022 cannot change authenticated 0664.
    await writeExact(fixture.root, runtimePath, bytes, historicalContinuationProducer.mode);
    const installed = await regularBytes(fixture.root, runtimePath);
    assert.equal(installed.digest, historicalContinuationProducer.rawDigest);
    assert.equal(installed.mode, historicalContinuationProducer.mode);
    for (const imported of ts.preProcessFile(bytes.toString("utf8"), true, true).importedFiles) {
      if (imported.fileName.startsWith("node:")) continue;
      assert.ok(imported.fileName.startsWith("."), "Historical producer may use only its existing native imports");
      const path = repositoryPath(relative(fixture.root,
        resolve(dirname(contained(fixture.root, runtimePath)), imported.fileName)).split(sep).join("/"));
      const expected = sourceFiles.get(path);
      assert.ok(expected, "Historical producer startup dependency is outside the authenticated snapshot: " + path);
      const actual = await regularBytes(fixture.root, path);
      assert.equal(actual.digest, expected.digest);
      assert.equal(actual.mode, expected.mode);
    }
    const native = await import(pathToFileURL(contained(fixture.root, runtimePath)).href) as {
      prepareLinearMetadataContinuation: typeof prepareLinearMetadataContinuation;
    };
    assert.equal(typeof native.prepareLinearMetadataContinuation, "function");
    const after = await regularBytes(fixture.root, runtimePath);
    assert.equal(after.digest, installed.digest);
    assert.equal(after.mode, installed.mode);
    return native.prepareLinearMetadataContinuation;
  }

  function selectedPacket(root: string, selection: typeof controller) {
    const result = deriveWork(loadSemanticGraph(root, selection.manifestPath),
      { selector: selection.workIri, profile: selection.profile, maxItems: 1 });
    assert.equal(result.status, "ok", JSON.stringify(result));
    assert.equal(result.items?.length, 1);
    const selected = result.items![0]!;
    assert.ok(selected.realisationBasis);
    return selected;
  }

  async function publishConstruction(root: string, selection: typeof controller) {
    const packet = selectedPacket(root, selection);
    const obligation = packet.realisationAuthority?.constructionProofObligation;
    assert.equal(typeof obligation, "string");
    const stem = ".usf/candidates/construction-authority/" + canonicalDigest(selection).slice(7);
    await mkdir(resolve(root, ".usf/candidates/construction-authority"), { recursive: true, mode: 0o700 });
    const common = ["--profile", selection.profile, "--manifest", selection.manifestPath];
    const evidence = await evidenceCommandHandler({ command: "evidence", repositoryRoot: root,
      args: ["construction", "--work", selection.workIri, ...common, "--output", stem + ".evidence.json"] });
    assert.equal(evidence.exitCode ?? 0, 0, JSON.stringify(evidence.output));
    const proof = await proveCommandHandler({ command: "prove", repositoryRoot: root,
      args: ["construction", "--obligation", obligation as string, "--evidence", stem + ".evidence.json",
        ...common, "--output", stem + ".proof.json"] });
    assert.equal(proof.exitCode ?? 0, 0, JSON.stringify(proof.output));
    assert.equal(object(object(proof.output, "proof").proof, "proof body").outcome, "pass");
    for (const mode of ["--verify", "--apply"]) {
      const result = await constructionAwarePublishCommandHandler({ command: "publish", repositoryRoot: root,
        args: ["construction-authority", "--bundle", stem + ".proof.json", ...common, mode] });
      assert.equal(result.exitCode ?? 0, 0, JSON.stringify(result.output));
    }
    assert.equal(selectedPacket(root, selection).eligibility?.construction.eligible, true);
  }

  async function currentBindingPublication(root: string) {
    const selected = selections[1]!;
    const graph = loadSemanticGraph(root, selected.manifestPath);
    const current = selectedPacket(root, selected);
    const permission = current.realisationAuthority?.permission;
    const basis = current.eligibility?.authorityBasisDigest;
    assert.ok(permission && typeof basis === "string");
    assert.equal(current.eligibility?.construction.eligible, true);
    assert.equal(current.eligibility?.construction.authority, "active-permission");
    assert.equal(current.eligibility?.activation.eligible, true);
    assert.equal(permission.activationState, "urn:usf:contract-state:active");
    const authority = deriveConstructionAuthority(graph, selected.workIri, selected.manifestPath);
    assert.equal(authority.sourcePath, bindingAuthoritySource);
    const grant = constructionGrantIri(selected.workIri, permission.id, basis);
    const intentDigest = exact(graph, grant, "publicationIntentDigest", "literal");
    assert.match(intentDigest, /^sha256:[a-f0-9]{64}$/u);
    const receiptPath = constructionReceiptPath(intentDigest, authority);
    const receiptFile = await regularBytes(root, receiptPath);
    const value: unknown = JSON.parse(receiptFile.bytes.toString("utf8"));
    assert.ok(validateConstructionReceiptShape(root, value, authority));
    const { receiptDigest, ...body } = value;
    assert.equal(value.status, "verified");
    assert.equal(value.members.length, 1);
    assert.equal(value.members[0]?.grantIri, grant);
    assert.equal(value.members[0]?.workIri, selected.workIri);
    assert.equal(value.members[0]?.authorityBasisDigest, basis);
    assert.equal(value.semanticSourcePath, bindingAuthoritySource);
    assert.equal(value.publicationReceiptPath, receiptPath);
    assert.equal(value.publicationIntentDigest, intentDigest);
    assert.equal(value.profileIri, selected.profile);
    assert.equal(value.manifestPath, selected.manifestPath);
    assert.equal(canonicalDigest(body, { rejectAbsolutePaths: true }), receiptDigest);
    assert.equal(canonicalJson(value, { rejectAbsolutePaths: true }) + "\n", receiptFile.bytes.toString("utf8"));
    assert.ok(value.operations.length > 0 && value.operations.every(operation =>
      operation.kind === "add" && operation.sourcePath === bindingAuthoritySource));
    const source = await regularBytes(root, bindingAuthoritySource);
    assert.equal(source.digest, value.resultingSourceDigest);
    assert.equal(selectedPacket(root, selected).eligibility?.authorityBasisDigest, basis,
      "Current authority moved while reading its native receipt");
    return {
      source: { path: bindingAuthoritySource, digest: source.digest, mode: source.mode },
      publicationReceipt: { path: receiptPath, digest: receiptFile.digest, mode: receiptFile.mode },
      publicationIntentDigest: intentDigest,
      publicationReceiptDigest: receiptDigest,
      authorityBasisDigest: basis,
    };
  }

  function selectedCompletionInputs(graph: SemanticGraph) {
    const authority = fixtureCompletionAuthority(graph, work, manifestPath);
    return fixtureCompletionDependencies(graph, authority);
  }

  function checkEngineInputPaths(graph: ReturnType<typeof loadSemanticGraph>): string[] {
    const path = repositoryPath(exact(graph, "urn:usf:schema:checked-candidate-execution-intent:1",
      "repositoryPath", "literal"));
    assert.equal(path, "schemas/checked-candidate-execution-intent.schema.json",
      "Use the check engine's exact graph-declared execution-intent schema");
    return [path, ...graph.manifests.map(item => item.path), ...Object.keys(graph.sourceDigests)];
  }

  function assertSchemaReferenceSelection(graph: SemanticGraph, checkGraph: ReturnType<typeof loadSemanticGraph>): void {
    const actualReferences = [
      "schemas/candidate.schema.json#/$defs/registrationFeatureOperation",
      "schemas/candidate.schema.json#/$defs/registrationFeaturePostimage",
    ];
    const actualRows = actualReferences.map(reference => {
      const row = graph.quads.find(quad => quad.predicate === predicate("schemaPath")
        && quad.objectKind === "literal" && quad.object === reference);
      assert.ok(row, "Regression must exercise the actual fragment-bearing bootstrap declaration: " + reference);
      assert.throws(() => repositoryPath(reference), /Schema or URI reference is not a repository file/u);
      return row;
    });
    const baseline = selectedCompletionInputs(graph);
    const authority = fixtureCompletionAuthority(graph, work, manifestPath);
    const selectedRow = graph.quads.find(quad => quad.subject === authority.policy.iri
      && quad.predicate === predicate("schemaPath") && quad.objectKind === "literal");
    assert.ok(selectedRow);
    const malformed = [
      "schemas/candidate.schema.json#",
      ...actualReferences,
      "schemas/candidate.schema.json#/$defs/escaped~0key~1value",
      "schemas/candidate.schema.json#/$defs/bad~2escape",
      "schemas/candidate.schema.json##/$defs/duplicate",
      "https://example.invalid/candidate.schema.json",
      "urn:usf:schema:native-fixture-reference:1",
      "../schemas/candidate.schema.json",
      "",
    ];
    // Unselected references, even duplicated or malformed, are not physical
    // inputs. Do not grow a second schema validator or traverse all graph rows.
    const unrelated = [...malformed, "schemas/unselected-native-preflight.schema.json"].flatMap(value =>
      ["schemaPath", "toolPath", "repositoryPath"].map(name => ({
        ...actualRows[0]!, subject: "urn:usf:schema:native-fixture-unselected:1",
        predicate: predicate(name), object: value,
      })));
    assert.deepEqual(selectedCompletionInputs({ ...graph,
      quads: [...graph.quads, ...actualRows, ...unrelated] }), baseline);
    assert.deepEqual(checkEngineInputPaths({ ...checkGraph,
      quads: [...checkGraph.quads, ...actualRows, ...unrelated] }), checkEngineInputPaths(checkGraph));
    assert.equal(new Set(baseline.map(input => input.path)).size, baseline.length);
    for (const reference of malformed) {
      const changed = { ...graph, quads: graph.quads.map(quad => quad === selectedRow
        ? { ...quad, object: reference } : quad) };
      assert.throws(() => selectedCompletionInputs(changed), /WORK_COMPLETION_/u,
        "Selected completion dependencies must refuse references, not trim or ignore them: " + reference);
    }
    assert.throws(() => selectedCompletionInputs({ ...graph, quads: [...graph.quads,
      { ...selectedRow, object: "schemas/unexpected-native-preflight.schema.json" }] }),
      /WORK_COMPLETION_POLICY_INVALID/u);
    const checkRow = checkGraph.quads.find(quad =>
      quad.subject === "urn:usf:schema:checked-candidate-execution-intent:1"
      && quad.predicate === predicate("repositoryPath"));
    assert.ok(checkRow);
    for (const reference of malformed) {
      assert.throws(() => checkEngineInputPaths({ ...checkGraph, quads: checkGraph.quads.map(quad =>
        quad === checkRow ? { ...quad, object: reference } : quad) }));
    }
    assert.throws(() => checkEngineInputPaths({ ...checkGraph, quads: [...checkGraph.quads, checkRow] }),
      /expected exactly one repositoryPath/u);
    assert.throws(() => checkEngineInputPaths({ ...checkGraph,
      quads: checkGraph.quads.filter(quad => quad !== checkRow) }), /expected exactly one repositoryPath/u);
    context.diagnostic("Snapshot reference regressions: actual bootstrap pointers, root/escaped/malformed references, duplicate and unrelated declarations, and selected-input refusals.");
  }

  function fixtureBindingsWithoutCanonicalHandoff(source: string) {
    const sourceGraph = "urn:usf:graph:linear-issue-bindings";
    const quads = parseStrictNQuads(source, sourceGraph);
    const removed = new Set([handoffPolicy, ...quads.filter(quad => quad.subject === handoffPolicy
      && quad.predicate === predicate("approvedRepairInput") && quad.objectKind === "iri").map(quad => quad.object)]);
    const retained = source.split("\n")
      .filter(line => ![...removed].some(subject => line.startsWith("<" + subject + "> "))).join("\n");
    assert.ok(retained.endsWith("\n"));
    assert.deepEqual(parseStrictNQuads(retained, sourceGraph), quads.filter(quad => !removed.has(quad.subject)),
      "Remove exactly the copied one-off admission and its linked input subjects; preserve every unrelated declaration");
    return { source: retained, removedSubjects: [...removed].filter(subject => quads.some(quad => quad.subject === subject)) };
  }

  async function planScopedSourceInputs(): Promise<Set<string>> {
    const pending = new Set([
      bindingManifestPath, "graph/manifests/integration.json", "graph/manifests/v3-convention.json",
      ".gitignore", "package.json", "pnpm-lock.yaml", "config/qualification.json",
      "config/execution-economics.json", "config/providers.json", "config/policy.json", carrierOnlyPath,
    ]);
    let qualificationGraph: SemanticGraph | undefined;
    for (const selection of selections) {
      const graph = loadSemanticGraph(sourceRoot, selection.manifestPath);
      const packet = selectedPacket(sourceRoot, selection);
      const prerequisite = await capturePrerequisiteCurrentness(graph, packet);
      const host = await captureNativeHostInputs(prerequisite.packets, prerequisite.prerequisites);
      for (const path of [...host.inputPaths, ...prerequisite.prerequisites.flatMap(item => item.inputPaths),
        ...graph.manifests.map(item => item.path), ...Object.keys(graph.sourceDigests)]) pending.add(path);
      for (const obligation of packet.validationPlan) {
        const closure = validationRuntimeClosure(graph, obligation.id);
        assert.ok(closure.repositoryReadFiles.length <= 128, "Do not expand the admitted runtime file cap");
        for (const path of closure.repositoryReadFiles) pending.add(path);
      }
      if (selection.workIri === work) {
        qualificationGraph = graph;
        // Only this selected work is completed; binding/controller steps publish
        // construction authority, whose dependencies are already authenticated.
        for (const dependency of selectedCompletionInputs(graph)) {
          const input = await captureSource(repositoryPath(dependency.path));
          assert.equal(input.digest, dependency.digest, "Completion dependency moved before capture: " + dependency.path);
          pending.add(dependency.path);
        }
      }
    }
    const integrationGraph = loadSemanticGraph(sourceRoot, "graph/manifests/integration.json");
    for (const path of checkEngineInputPaths(integrationGraph)) pending.add(path);
    assert.ok(qualificationGraph);
    if (preflightOnly) assertSchemaReferenceSelection(qualificationGraph, integrationGraph);
    return pending;
  }


  interface RuntimeAsset {
    readonly sourcePath: string;
    readonly targetPath: string;
    readonly input: Awaited<ReturnType<typeof regularBytes>>;
  }
  interface RuntimePackage {
    readonly name: string;
    readonly version: string;
    readonly sourceManifestPath: string;
    readonly sourceDirectory: string;
    readonly manifest: Record<string, unknown>;
    readonly dependencies: Map<string, RuntimePackage>;
  }
  interface RuntimeAssetPlan {
    readonly packages: Map<string, RuntimePackage>;
    readonly files: Map<string, RuntimeAsset>;
    readonly directories: Map<string, { mode: number; names: string[] }>;
    readonly roots: Map<string, NonNullable<Awaited<ReturnType<typeof observeInstalledAdapter>>>>;
    readonly bytes: number;
  }
  let runtimeAssets: RuntimeAssetPlan | undefined;
  const runtimeRoots = ["@ai-sdk/groq", "ai"] as const;

  async function runtimePackageManifest(root: string, parentManifest: string, name: string) {
    assert.match(name, /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u);
    const resolver = createRequire(contained(root, parentManifest));
    let manifest: string | undefined;
    try { manifest = await realpath(resolver.resolve(name + "/package.json")); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") throw error;
    }
    let cursor = manifest === undefined ? dirname(await realpath(resolver.resolve(name))) : dirname(manifest);
    for (let depth = 0; depth < 16; depth++) {
      const path = repositoryPath(relative(root, resolve(cursor, "package.json")).split(sep).join("/"));
      try {
        const input = await regularBytes(root, path, 256 * 1024);
        const record = object(JSON.parse(input.bytes.toString("utf8")), "Installed package manifest");
        if (record.name === name) {
          assert.equal(typeof record.version, "string");
          assert.match(record.version as string, /^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/u);
          return { path, directory: dirname(path).split(sep).join("/"), record, version: record.version as string };
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      assert.equal(manifest, undefined, "Resolved package manifest has the wrong package identity");
      assert.notEqual(cursor, root, "Package manifest lookup may not leave its repository");
      cursor = dirname(cursor);
    }
    assert.fail("Installed package has no bounded, contained manifest: " + name);
  }

  async function captureRuntimeAssetPlan(): Promise<RuntimeAssetPlan> {
    const lock = object(parseYaml(sourceFiles.get("pnpm-lock.yaml")!.bytes.toString("utf8")), "Copied pnpm lock");
    const lockedPackages = object(lock.packages, "Locked packages");
    const lockedSnapshots = object(lock.snapshots, "Locked runtime dependency snapshots");
    const packages = new Map<string, RuntimePackage>();
    const files = new Map<string, RuntimeAsset>();
    const directories = new Map<string, { mode: number; names: string[] }>();
    const roots: RuntimeAssetPlan["roots"] = new Map();
    let bytes = 0;
    const dependencyNames = (value: unknown): string[] => value === undefined ? [] : Object.keys(object(value, "Package dependency declarations"));
    const visit = async (parentManifest: string, name: string): Promise<RuntimePackage> => {
      const found = await runtimePackageManifest(sourceRoot, parentManifest, name);
      assert.ok(found.path.startsWith("node_modules/") || found.path.startsWith(".usf/cache/pnpm-virtual-store/"),
        "Runtime package assets may not copy operational state or arbitrary repository paths");
      const previous = packages.get(name);
      if (previous !== undefined) {
        assert.equal(found.path, previous.sourceManifestPath, "A flat fixture runtime cannot merge distinct installed package identities: " + name);
        assert.equal(found.version, previous.version);
        return previous;
      }
      assert.ok(packages.size < 32, "The selected adapter/SDK runtime must remain a bounded package closure");
      const key = name + "@" + found.version;
      const locked = object(lockedPackages[key], "Exact lock entry for " + key);
      const resolution = object(locked.resolution, "Locked package resolution");
      assert.equal(typeof resolution.integrity, "string");
      assert.match(resolution.integrity as string, /^sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}$/u);
      const entry: RuntimePackage = { name, version: found.version, sourceManifestPath: found.path,
        sourceDirectory: found.directory, manifest: found.record, dependencies: new Map() };
      packages.set(name, entry);
      const required = new Set(dependencyNames(found.record.dependencies));
      const optional = new Set(dependencyNames(found.record.optionalDependencies));
      const peers = dependencyNames(found.record.peerDependencies);
      const peerMeta = found.record.peerDependenciesMeta === undefined ? {} : object(found.record.peerDependenciesMeta, "Peer metadata");
      for (const dependency of [...new Set([...required, ...optional, ...peers])].sort()) {
        const meta = peerMeta[dependency];
        const optionalPeer = meta !== null && typeof meta === "object" && !Array.isArray(meta)
          && (meta as Record<string, unknown>).optional === true;
        try { await runtimePackageManifest(sourceRoot, found.path, dependency); }
        catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (!required.has(dependency) && (optional.has(dependency) || optionalPeer)
            && (code === "MODULE_NOT_FOUND" || code === "ERR_MODULE_NOT_FOUND")) continue;
          throw error;
        }
        entry.dependencies.set(dependency, await visit(found.path, dependency));
      }
      // These are lockfile package-version references, not raw-file SHA values.
      // Native root lockDigest remains its own package/version/integrity domain.
      const matching = Object.entries(lockedSnapshots).filter(([snapshotKey, value]) => {
        if (snapshotKey !== key && !snapshotKey.startsWith(key + "(")) return false;
        const snapshot = object(value, "Locked package snapshot");
        const dependencies = { ...(snapshot.dependencies === undefined ? {} : object(snapshot.dependencies, "Snapshot dependencies")),
          ...(snapshot.optionalDependencies === undefined ? {} : object(snapshot.optionalDependencies, "Snapshot optional dependencies")) };
        return [...entry.dependencies].every(([dependency, child]) =>
          typeof dependencies[dependency] === "string"
          && (dependencies[dependency] as string).split("(", 1)[0] === child.version);
      });
      assert.ok(matching.length > 0, "Installed runtime dependency edges disagree with their exact lock snapshot: " + key);
      return entry;
    };
    for (const name of runtimeRoots) {
      const observed = await observeInstalledAdapter(sourceRoot, name);
      assert.ok(observed, "Runtime root lacks a native version/integrity observation: " + name);
      roots.set(name, observed);
      const selected = await visit("package.json", name);
      assert.equal(selected.version, observed.version);
    }
    for (const entry of [...packages.values()].sort((a, b) => a.name.localeCompare(b.name))) {
      const walk = async (path: string): Promise<void> => {
        const sourcePath = path === "" ? entry.sourceDirectory : entry.sourceDirectory + "/" + path;
        const status = await lstat(contained(sourceRoot, sourcePath));
        assert.ok(status.isDirectory() && !status.isSymbolicLink(), "Linked package directories are forbidden");
        const members = (await readdir(contained(sourceRoot, sourcePath), { withFileTypes: true }))
          .sort((a, b) => a.name.localeCompare(b.name));
        directories.set(sourcePath, { mode: status.mode & 0o777, names: members.map(member => member.name) });
        assert.ok(sourceDirectoryModes.size + directories.size <= 2048, "Combined source/runtime directories exceed the scoped-copy bound");
        for (const member of members) {
          assert.notEqual(member.name, "node_modules", "Bundled dependency trees require an explicit package plan");
          assert.ok(!member.isSymbolicLink(), "Runtime package assets must not contain symlinks");
          const child = path === "" ? member.name : path + "/" + member.name;
          if (member.isDirectory()) await walk(child);
          else {
            assert.ok(member.isFile(), "Runtime assets must be regular files");
            const source = entry.sourceDirectory + "/" + child;
            const target = repositoryPath("node_modules/" + entry.name + "/" + child);
            const input = await regularBytes(sourceRoot, source);
            assert.ok(!files.has(target), "Runtime asset destination collision");
            files.set(target, { sourcePath: source, targetPath: target, input });
            bytes += input.bytes.length;
            assert.ok(sourceFiles.size + files.size <= 4096, "Combined source/runtime files exceed the existing producer-copy bound");
            assert.ok(snapshotBytes + bytes <= 128 * 1024 * 1024, "Combined source/runtime bytes exceed the existing scoped-copy bound");
          }
        }
      };
      await walk("");
    }
    return { packages, files, directories, roots, bytes };
  }

  async function assertRuntimeAssetsUnchanged(): Promise<void> {
    if (runtimeAssets === undefined) return;
    for (const [name, observation] of runtimeAssets.roots) {
      assert.deepEqual(await observeInstalledAdapter(sourceRoot, name), observation, "Native runtime identity moved: " + name);
    }
    for (const [path, inventory] of runtimeAssets.directories) {
      const current = await lstat(contained(sourceRoot, path));
      assert.ok(current.isDirectory() && !current.isSymbolicLink());
      assert.equal(current.mode & 0o777, inventory.mode);
      assert.deepEqual((await readdir(contained(sourceRoot, path))).sort(), [...inventory.names].sort(),
        "Installed runtime directory membership moved: " + path);
    }
    for (const asset of runtimeAssets.files.values()) {
      const current = await regularBytes(sourceRoot, asset.sourcePath);
      assert.equal(current.digest, asset.input.digest, "Installed runtime bytes moved: " + asset.sourcePath);
      assert.equal(current.mode, asset.input.mode, "Installed runtime mode moved: " + asset.sourcePath);
    }
  }

  async function materializeRuntimeAssets(root: string): Promise<void> {
    assert.ok(runtimeAssets);
    for (const asset of runtimeAssets.files.values()) {
      const target = contained(root, asset.targetPath);
      copiedBytes += asset.input.bytes.length;
      assert.ok(copiedBytes <= 128 * 1024 * 1024, "Runtime assets share the existing materialization byte budget");
      await mkdir(dirname(target), { recursive: true, mode: 0o755 });
      await writeFile(target, asset.input.bytes, { flag: "wx", mode: asset.input.mode });
      await chmod(target, asset.input.mode);
      const copied = await lstat(target);
      assert.equal(copied.nlink, 1);
      assert.ok(copied.dev !== asset.input.dev || copied.ino !== asset.input.ino, "Runtime asset shares a canonical inode");
    }
    for (const entry of runtimeAssets.packages.values()) {
      for (const [path, inventory] of [...runtimeAssets.directories].sort(([a], [b]) => b.length - a.length)) {
        if (path !== entry.sourceDirectory && !path.startsWith(entry.sourceDirectory + "/")) continue;
        const suffix = path.slice(entry.sourceDirectory.length);
        const directory = contained(root, "node_modules/" + entry.name + suffix);
        await mkdir(directory, { recursive: true, mode: 0o755 });
        await chmod(directory, inventory.mode);
      }
      const copied = await runtimePackageManifest(root, "package.json", entry.name);
      assert.equal(copied.path, "node_modules/" + entry.name + "/package.json");
      for (const [name, expected] of entry.dependencies) {
        const dependency = await runtimePackageManifest(root, copied.path, name);
        assert.equal(dependency.path, "node_modules/" + expected.name + "/package.json",
          "Copied runtime dependency falls back outside the admitted fixture installation");
        assert.equal(dependency.version, expected.version);
      }
    }
    // Loading the actual contained adapter and SDK checks their executable
    // runtime closure without generating text or contacting any provider.
    for (const name of runtimeRoots) {
      const entry = await realpath(createRequire(contained(root, "package.json")).resolve(name));
      const path = repositoryPath(relative(root, entry).split(sep).join("/"));
      assert.ok(runtimeAssets.files.has(path), "Runtime entrypoint is outside the copied package plan");
      const module = await import(pathToFileURL(contained(root, path)).href) as Record<string, unknown>;
      assert.equal(typeof module[name === "ai" ? "generateText" : "createGroq"], "function");
    }
    await assertRuntimeAssetsUnchanged();
  }

  async function writeFixtureProviderInputs(root: string): Promise<void> {
    await mkdir(resolve(root, ".usf/catalog"), { recursive: true, mode: 0o700 });
    await mkdir(resolve(root, ".usf/provider-home"), { recursive: true, mode: 0o700 });
    await writeExact(root, envPath, "GROQ_API_KEY=qualification-fixture-only\n", 0o600);
    const raw = Buffer.from(JSON.stringify({ groq: {
      id: "groq", name: "Groq offline fixture", npm: "@ai-sdk/groq", env: ["GROQ_API_KEY"],
      models: { [model]: { id: model, name: "Qualification fixture", family: "qwen",
        reasoning: true, structured_output: true, tool_call: true,
        modalities: { input: ["text"], output: ["text"] }, cost: { input: 0, output: 0 },
        limit: { context: 131072, output: 8192 } } },
    } }));
    assert.ok(runtimeAssets);
    const adapter = runtimeAssets.roots.get("@ai-sdk/groq")!;
    await writeExact(root, ".usf/catalog/models-dev.raw.json", raw, 0o600);
    await writeExact(root, ".usf/catalog/models-dev.normalized.json",
      canonicalJson(normalizeModelsDevCatalogue(raw, { installedAdapters: { "@ai-sdk/groq": adapter.version } })), 0o600);
  }

  interface NativeExecutionSelection {
    readonly selectedUnits: readonly string[];
    readonly args: readonly string[];
  }

  async function assertNativeRouteAdmission(root: string, binding?: PreparedLinearBinding): Promise<NativeExecutionSelection | undefined> {
    assert.ok(runtimeAssets);
    const countsBefore = { ...counts };
    const observedRoots = new Map<string, NonNullable<Awaited<ReturnType<typeof observeInstalledAdapter>>>>();
    for (const [name, expected] of runtimeAssets.roots) {
      const observed = await observeInstalledAdapter(root, name);
      assert.deepEqual(observed, expected, "Disposable runtime lacks its genuine native installation: " + name);
      assert.ok(observed);
      observedRoots.set(name, observed);
    }
    const catalogue = await readLocalCatalogue(root);
    const graph = loadSemanticGraph(root, "graph/manifests/v3-convention.json");
    const bindings = readProviderBindings(graph);
    const executionPolicy = readProviderExecutionPolicy(graph);
    const economics = readGraphDerivedEconomics(JSON.parse((await regularBytes(root, "config/execution-economics.json")).bytes.toString("utf8")), graph);
    const names = [...new Set(catalogue.snapshot.providers.flatMap(provider => provider.credentialNames ?? []))]
      .filter(name => /^[A-Z_][A-Z0-9_]{0,127}$/u.test(name)).sort();
    const environment = await loadCredentialEnvFile(contained(root, envPath), names);
    const requiredCapabilities = binding === undefined ? [] : [...binding.unit.modelCapabilities].sort();
    let minimumContextTokens: number | null = null;
    const maximumOutputTokens = binding?.unit.maximumOutputTokens ?? 1024;
    let executionSelection: NativeExecutionSelection | undefined;
    if (binding !== undefined) {
      const unit = binding.unit;
      assert.equal(unit.bindingIri, fixtureBindingIri);
      assert.equal(unit.workIri, work);
      assert.equal(unit.profile, profile);
      assert.equal(unit.manifestPath, manifestPath);
      const selectedUnits = Object.freeze([unit.unitIri]);
      assert.ok(unit.unitIri.length > 0 && !unit.unitIri.includes(","),
        "The native --only selector must round-trip the exact bound unit IRI");
      const sourceGraph = "urn:usf:graph:hermes-input:" + unit.attemptKey;
      const quads = parseStrictNQuads((await regularBytes(root, binding.unitPath)).bytes.toString("utf8"), sourceGraph);
      assert.deepEqual([...new Set(quads.filter(quad => quad.predicate === predicate("type")
        && quad.objectKind === "iri" && quad.object === "urn:usf:type:SemanticWorkUnit").map(quad => quad.subject))].sort(),
        selectedUnits, "Execution selection must match the actual binding's emitted work units");
      executionSelection = Object.freeze({ selectedUnits, args: Object.freeze([
        "--input", binding.unitPath, "--graph", sourceGraph, "--only", selectedUnits.join(","),
        "--env-file", envPath, "--concurrency", "1",
      ]) });
      const own = quads.filter(quad => quad.subject === unit.unitIri);
      const literals = (name: string) => own.filter(quad => quad.predicate === predicate(name)
        && quad.objectKind === "literal").map(quad => quad.object);
      assert.deepEqual(literals("prompt"), [unit.prompt]);
      assert.deepEqual([...new Set([...literals("modelCapability"), ...literals("requiredCapability")])].sort(),
        requiredCapabilities, "Preflight must use the native binding's actual emitted capability requirements");
      assert.deepEqual(literals("maximumOutputTokens"), unit.maximumOutputTokens === undefined ? [] : [String(unit.maximumOutputTokens)]);
      const contextValues = literals("minimumContextTokens");
      assert.ok(contextValues.length <= 1);
      if (contextValues.length === 1) {
        assert.match(contextValues[0]!, /^[1-9][0-9]{0,9}$/u);
        minimumContextTokens = Number(contextValues[0]);
      }
    }
    const qualification = await observeQualifiedTaskClasses(root);
    const input = {
      snapshot: catalogue.snapshot,
      installedAdapterPackages: [...observedRoots.keys()],
      suppliedCredentialNames: names.filter(name => Boolean(environment.getCredential(name))),
      authorizations: economics.authorizations, policy: economics.policy,
      requirement: { requiredCapabilities, minimumContextTokens, minimumOutputTokens: binding === undefined ? null : maximumOutputTokens },
      observedAvailableRouteIds: (await observeAvailableRoutes(root)).routeIds,
      executionPolicy, credentialAliases: bindings.credentialAliases, providerEndpoints: bindings.endpoints,
      transportSelectedModel: bindings.transportSelectedModel, localAgentCapabilities: [],
      qualifiedTaskClassesByRoute: qualification.byRoute,
    };
    const universe = deriveRouteUniverse(input);
    const classifications = classifyCatalogue(input).classifications;
    assert.equal(universe.candidates.length, 1, "Native route admission refused: " + JSON.stringify(classifications));
    const candidate = universe.candidates[0]!;
    assert.equal(candidate.provider, "groq");
    assert.equal(candidate.model, model);
    assert.equal(candidate.transport, "vercel-ai-sdk");
    assert.equal(candidate.adapterPackage, "@ai-sdk/groq");
    assert.equal(sdkPreflightRefusal({ adapterPackage: candidate.adapterPackage, model: candidate.model,
      credential: candidate.credentialName === null ? undefined : environment.getCredential(candidate.credentialName) ?? undefined }), null);
    if (binding !== undefined) {
      assert.ok(qualification.byRoute.has("groq:" + model), "Execution admission requires native recorded qualification, not catalogue claims");
      assert.ok(sdkInvocationLimits(candidate, { prompt: binding.unit.prompt, maximumOutputTokens }, 300_000),
        "Bound contribution prompt/output limits do not fit the selected native SDK route");
    } else assert.equal(qualification.byRoute.size, 0, "Initial route admission must not invent earned task classes");
    for (const [name, previous] of observedRoots) {
      assert.deepEqual(await observeInstalledAdapter(root, name), previous, "Native adapter identity changed during admission");
    }
    assert.deepEqual(counts, countsBefore, "Route preflight must not dispatch, integrate or contact even the fake provider");
    context.diagnostic("Provider-free " + (binding === undefined ? "qualification" : "qualified bound-work execution")
      + " admission: " + candidate.candidateId + "; capabilities=" + requiredCapabilities.join(","));
    return executionSelection;
  }

  async function createScopedSourceSnapshot(): Promise<void> {
    const pending = await planScopedSourceInputs();
    const visited = new Set<string>();
    const failures: string[] = [];
    while (pending.size > 0) {
      const path = pending.values().next().value!;
      pending.delete(path);
      if (visited.has(path)) continue;
      visited.add(path);
      assert.ok(visited.size <= 2048, "Scoped input plan exceeds its unchanged file bound");
      try {
        const input = await captureSource(repositoryPath(path));
        if (path.endsWith(".json")) {
          const value = JSON.parse(input.bytes.toString("utf8")) as {
            schema?: string; imports?: string[]; sources?: Array<{ path: string }>;
          };
          if (value.schema === "urn:usf:graph-manifest:2") {
            for (const dependency of [...(value.imports ?? []), ...(value.sources ?? []).map(item => item.path)]) {
              pending.add(dependency);
            }
          }
        }
      } catch (error) {
        failures.push(path + ": " + (error instanceof Error ? error.message : String(error)));
      }
    }
    assert.deepEqual(failures, [], "Snapshot preflight must resolve every selected physical input before materialization");
    assert.equal(sourceFiles.get(acceptancePath)?.digest, acceptanceDigest);
    assert.equal(sourceFiles.get(wrapperPath)?.bytes.toString("utf8"),
      'import "./cli-provider-qualification-help.acceptance.ts";\n');
    await assertCanonicalUnchanged();
  }

  function fixtureBindingText(binding = fixtureBindingIri, issueUuid = "5e130f19-e6b4-4b32-b630-941c9a2b7001"): string {
    const graph = "urn:usf:graph:linear-issue-bindings";
    const fields: ReadonlyArray<readonly [string, string, boolean]> = [
      ["type", "urn:usf:type:LinearIssueWorkBinding", true],
      ["canonicalIssueLocator", "maldous:" + issueUuid, false],
      ["issueWorkspace", "maldous", false], ["issueUuid", issueUuid, false],
      ["owningModel", "USF", false], ["workIri", work, true], ["selectedProfile", profile, true],
      ["targetManifest", manifestPath, false], ["maximumPromptTokens", "12000", false],
      ["maximumOutputTokens", "8192", false],
      ["fixedPrompt", "qualification-fixture-native-contribution: return the exact bounded help metadata replacement. Preserve the immutable acceptance and all other bytes. This is an offline transport fixture, not live provider evidence.", false],
      ["sourceContext", JSON.stringify([
        { path: helpPath, start: 'const probeQualifyTopic = topic(', end: "\n\nexport const commandRegistry", maximumBytes: 4096 },
        { path: acceptancePath, start: 'import assert from "node:assert/strict";', end: "\n});", maximumBytes: 4096 },
      ]), false],
    ];
    return fields.map(([name, value, iri]) => "<" + binding + "> <" + predicate(name) + "> "
      + (iri ? "<" + value + ">" : JSON.stringify(value)) + " <" + graph + "> .").join("\n") + "\n";
  }

  async function authorFixture(fixture: Fixture) {
    const { before, correction } = metadataPlan;
    const beforeSpans = metadataSpans(before);
    const afterSpans = metadataSpans(correction.source);
    const oldText = before.slice(beforeSpans[0]!.start, beforeSpans.at(-1)!.end);
    const newText = correction.source.slice(afterSpans[0]!.start, afterSpans.at(-1)!.end);
    // A fresh Git carrier's ordinary non-executable metadata file is 0644.
    // Other copied files retain their independently observed physical modes.
    await writeExact(fixture.root, helpPath, before, 0o644);
    const bindingSource = sourceFiles.get(bindingGraphPath)!;
    const baselineBindings = fixtureBindingsWithoutCanonicalHandoff(bindingSource.bytes.toString("utf8")).source;
    await writeExact(fixture.root, bindingGraphPath, baselineBindings + fixtureBindingText()
      + fixtureBindingText(historicalBindingIri, "5e130f19-e6b4-4b32-b630-941c9a2b7002"), bindingSource.mode);

    const vocabulary = sourceFiles.get(vocabularyPath)!;
    const newTypes = ["urn:usf:type:ConstructionContinuationRepairAdmission", "urn:usf:type:ConstructionContinuationRepairInput"];
    const vocabularyLines = vocabulary.bytes.toString("utf8").split("\n");
    const addedVocabulary = vocabularyLines.filter(line => newTypes.some(subject => line.startsWith("<" + subject + "> ")));
    assert.ok(addedVocabulary.length >= 2, "The frozen parent cohort must declare both handoff types");
    await writeExact(fixture.root, vocabularyPath,
      vocabularyLines.filter(line => !newTypes.some(subject => line.startsWith("<" + subject + "> "))).join("\n"),
      vocabulary.mode);

    for (const selection of selections) {
      const graph = loadSemanticGraph(fixture.root, selection.manifestPath);
      const authority = deriveConstructionAuthority(graph, selection.workIri, selection.manifestPath);
      const marker = "urn:usf:record:native-qualification-empty-" + canonicalDigest(selection).slice(7);
      const contract = exact(graph, selection.workIri, "contract", "iri");
      await writeExact(fixture.root, authority.sourcePath, [
        "<" + marker + "> <" + predicate("forContract") + "> <" + contract + "> <" + authority.targetGraphIri + "> .",
        "<" + marker + "> <" + predicate("text") + '> "Disposable native fixture; no selected construction or completion receipts imported." <' + authority.targetGraphIri + "> .",
        "<" + marker + "> <" + predicate("type") + "> <urn:usf:type:SemanticRecordType> <" + authority.targetGraphIri + "> .",
      ].join("\n") + "\n", sourceFiles.get(authority.sourcePath)!.mode);
    }
    for (const selection of selections) await publishConstruction(fixture.root, selection);
    return { operation: { kind: "replace", path: helpPath, oldText, newText },
      expectedHelp: correction.source, addedVocabulary };
  }

  async function fixtureGit(root: string, args: string[]) {
    return execFileAsync("git", args, { cwd: root, timeout: 30_000, maxBuffer: 4 * 1024 * 1024,
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: resolve(root, ".usf/git-home"),
        GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" } });
  }

  async function initialiseCarrier(root: string): Promise<void> {
    await mkdir(resolve(root, ".usf/git-home"), { recursive: true, mode: 0o700 });
    await fixtureGit(root, ["init", "--quiet", "--initial-branch=native-qualification"]);
    await fixtureGit(root, ["config", "user.name", "USF native qualification fixture"]);
    await fixtureGit(root, ["config", "user.email", "native-qualification@example.invalid"]);
    await fixtureGit(root, ["config", "commit.gpgsign", "false"]);
    await fixtureGit(root, ["add", "--", "."]);
    await fixtureGit(root, ["commit", "--quiet", "-m", "Native qualification fixture preimage"]);
  }

  interface NativeBlob { value: Record<string, unknown>; files: Array<{ path: string; bytes: Buffer; mode: number }>; }
  async function readBlobAt(root: string, hash: string): Promise<NativeBlob> {
    assert.match(hash, /^sha256:[a-f0-9]{64}$/u);
    const authenticated: Array<NativeBlob & { source: string }> = [];
    // Authenticate both bounded namespaces. Neither a missing head nor a valid
    // alternate representation may hide corrupt or incomplete immutable records.
    for (const version of [1, 2] as const) {
      const records: Array<Awaited<ReturnType<typeof readLinearRecord>>> = [];
      const keys: string[] = [];
      for (let index = 0; index < Math.ceil(1311 / 128); index++) {
        const key = (version === 1 ? "continuation-blob-" : "continuation-blob-v2-") + hash.slice(7) + "-" + index;
        keys.push(key);
        records.push(await readLinearRecord(root, key));
      }
      if (records.every(record => record === null)) continue;
      const first = object(records[0], "native continuation blob head");
      const count = first.count;
      assert.ok(typeof count === "number" && Number.isInteger(count) && count > 0 && count <= 1311);
      const chunks: string[] = [];
      const files: NativeBlob["files"] = [];
      for (let index = 0; index < records.length; index++) {
        if (index >= Math.ceil(count / 128)) {
          assert.equal(records[index], null, "Unexpected trailing blob record");
          continue;
        }
        const record = object(records[index], "native continuation blob");
        assert.deepEqual(Object.keys(record).sort(), (version === 1
          ? ["digest", "offset", "chunks", "count"] : ["schema", "digest", "offset", "chunks", "count"]).sort());
        if (version === 2) assert.equal(record.schema, "urn:usf:linear-continuation-blob:2");
        assert.equal(record.digest, hash);
        assert.equal(record.offset, index * 128);
        assert.equal(record.count, count);
        assert.ok(Array.isArray(record.chunks));
        assert.equal(record.chunks.length, Math.min(128, count - index * 128));
        for (const chunk of record.chunks) {
          assert.ok(typeof chunk === "string" && chunk.length > 0 && chunk.length <= (version === 1 ? 400 : 409));
          if (version === 1) chunks.push(chunk);
          else {
            const frame = /^usf2:([1-9][0-9]{0,2}):([\s\S]*)$/u.exec(chunk);
            assert.ok(frame, "Native v2 blob requires an exact opaque UTF16 frame");
            const length = Number(frame[1]), decoded = frame[2]!;
            assert.ok(length <= 400);
            assert.equal(decoded.length, length);
            if (chunks.length < count - 1) assert.equal(length, 400);
            chunks.push(decoded);
          }
        }
        const path = ".usf/hermes/linear/records/" + keys[index]! + ".json";
        const input = await regularBytes(root, path, 1024 * 1024);
        assert.equal(input.mode, 0o600);
        files.push({ path, bytes: input.bytes, mode: input.mode });
      }
      // Preserve split surrogate pairs by joining code units before JSON/hash.
      const source = chunks.join("");
      assert.ok(source.length > 0 && source.length <= 512 * 1024);
      const value = object(JSON.parse(source), "native blob value");
      assert.equal(canonicalJson(value), source);
      assert.equal(canonicalDigest(value), hash);
      if (version === 2) assert.equal(canonicalJson(value, { rejectAbsolutePaths: true }), source);
      authenticated.push({ source, value, files });
    }
    assert.ok(authenticated.length > 0, "Native blob is absent from both namespaces");
    const selected = authenticated[0]!;
    for (const entry of authenticated) assert.equal(entry.source, selected.source, "Blob namespaces disagree");
    return { value: selected.value, files: authenticated.flatMap(entry => entry.files) };
  }

  async function continuationAt(root: string) {
    const pointer = object(await readLinearRecord(root, pointerKey), "native continuation pointer");
    const repaired = pointer.schema === "urn:usf:linear-continuation-pointer:2";
    assert.ok(repaired || pointer.schema === "urn:usf:linear-continuation-pointer:1");
    assert.deepEqual(Object.keys(pointer).sort(), (repaired
      ? ["schema", "intentDigest", "stateDigest", "handoffReceiptDigest"]
      : ["schema", "intentDigest", "stateDigest"]).sort());
    assert.equal(typeof pointer.intentDigest, "string");
    assert.equal(typeof pointer.stateDigest, "string");
    const intent = await readBlobAt(root, pointer.intentDigest as string);
    const state = await readBlobAt(root, pointer.stateDigest as string);
    assert.equal(state.value.intentDigest, pointer.intentDigest);
    let handoff: NativeBlob | null = null;
    if (repaired) {
      assert.equal(typeof pointer.handoffReceiptDigest, "string");
      handoff = await readBlobAt(root, pointer.handoffReceiptDigest as string);
      const receipt = handoff.value;
      assert.equal(receipt.schema, "urn:usf:linear-continuation-repair-handoff-receipt:1");
      assert.equal(receipt.successorIntentDigest, pointer.intentDigest);
      assert.deepEqual(intent.value.repairHandoff, {
        predecessorIntentDigest: receipt.predecessorIntentDigest,
        predecessorStateDigest: receipt.predecessorStateDigest,
        admissionDigest: receipt.admissionDigest,
        ...(receipt.currentAuthorityInputs === undefined ? {} : { currentAuthorityInputs: receipt.currentAuthorityInputs }),
      });
      assert.equal(typeof receipt.successorStateDigest, "string");
      const admitted = (await readBlobAt(root, receipt.successorStateDigest as string)).value;
      assert.equal(admitted.intentDigest, pointer.intentDigest);
      assert.equal(admitted.nextStep, 0);
      assert.deepEqual(admitted.pending, receipt.adoptedPending ?? null);
      assert.equal(admitted.terminal, false);
      assert.deepEqual(admitted.completedEffects, []);
      assert.notEqual(admitted.integration, null);
      assert.deepEqual(admitted.integration, state.value.integration);
    } else assert.equal(intent.value.repairHandoff, undefined);
    return { pointer, intent, state, handoff };
  }

  const emptyCounts = () => ({ qualificationRequests: 0, deliveryRequests: 0, graphDispatches: 0, integrations: 0 });
  const laneCounts = { ordinary: emptyCounts(), handoff: emptyCounts() };
  let counts = laneCounts.ordinary;
  let activeContribution: Awaited<ReturnType<typeof authorFixture>>["operation"] | undefined;
  const model = "qwen/qwen3.6-27b";
  const envPath = ".usf/credentials/qualification-fixture.env";
  const answerByCase: Record<string, string> = {
    "cli-plan-operator-intent": "intent", "cli-foreground-lifecycle": "foreground",
    "cli-structured-invocation": '{"command":"usf","arguments":["help"]}',
    "cli-reusable-command-boundary": "registered command, no ad hoc script",
    "node-test-runner": "node --test",
    "node-test-diagnostic-fixture": "deterministic fixture and failure reason",
    "node-test-evidence-boundary": "production and provider availability",
    "node-test-regression-economy": "focused test, full gate",
    "route-complete-partition": "configured, assigned, excluded, eligible-unassigned",
    "route-contact-order": "local-first", "route-unknown-entitlement": "unknown; insufficient evidence",
    "route-noncompletion-boundary": '{"probeEstablishesQualification":false,"assignmentEstablishesProof":false}',
    "typescript-readonly-contract": "readonly",
    "typescript-two-layer-validation": "runtime validation and type checking",
    "typescript-bounded-result": '{"files":[],"risk":"bounded"}',
    "typescript-authorized-scope": "smallest",
  };

  for (const name of ["USF_STEWARD_SESSION_ID", "USF_STEWARD_CLAIM_ID", "USF_STEWARD_GENERATION"]) {
    assert.equal(process.env[name], undefined, "Never inherit canonical stewardship into disposable fixtures");
  }
  await createScopedSourceSnapshot();
  const metadataPlan = fixtureMetadataPlan();
  context.diagnostic("Native metadata grammar preflight: exact authored pre/postimages accepted; protected bytes and envFileOption preserved.");
  runtimeAssets = await captureRuntimeAssetPlan();
  await assertRuntimeAssetsUnchanged();
  const config = JSON.parse(sourceFiles.get("config/qualification.json")!.bytes.toString("utf8")) as {
    suite: { cases: Array<{ caseId: string; prompt: string }> };
  };
  const responses = new Map(config.suite.cases.map(item => {
    assert.equal(typeof answerByCase[item.caseId], "string", "Unexpected qualification case requires an explicit fixture response");
    return [item.prompt, answerByCase[item.caseId]!] as const;
  }));
  // This is the only substituted boundary: an in-process transport response.
  // Native SDK translation, routing, qualification, durable execution evidence,
  // contribution admission, confinement, integration and publication are real.
  let allowFixtureContact = false;
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(allowFixtureContact, true, "Provider contact is forbidden during runtime setup and route preflight");
    const request = new Request(input, init);
    assert.equal(request.url, "https://api.groq.com/openai/v1/chat/completions", "Unexpected network request is forbidden");
    assert.equal(request.headers.get("authorization"), "Bearer qualification-fixture-only");
    const body = object(JSON.parse(await request.text()), "SDK request");
    assert.equal(body.model, model);
    assert.ok(Array.isArray(body.messages));
    const prompt = body.messages.map(message => {
      const item = object(message, "SDK message");
      assert.equal(typeof item.content, "string");
      return item.content as string;
    }).join("\n");
    let text = responses.get(prompt);
    if (text === undefined) {
      assert.ok(prompt.includes("qualification-fixture-native-contribution"), "Unknown SDK fixture request");
      counts.deliveryRequests++;
      assert.equal(counts.deliveryRequests, 1, "Every delivery invocation is counted, including duplicates");
      assert.ok(activeContribution, "Delivery requires the active lane\'s native contribution");
      text = JSON.stringify([activeContribution]);
    } else counts.qualificationRequests++;
    return new Response(JSON.stringify({
      id: "native-qualification-fixture-" + (counts.qualificationRequests + counts.deliveryRequests),
      object: "chat.completion", created: 0, model,
      choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
      usage: { prompt_tokens: 128, completion_tokens: 128, total_tokens: 256 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  if (preflightOnly) {
    const bindingSource = sourceFiles.get(bindingGraphPath)!;
    const stripped = fixtureBindingsWithoutCanonicalHandoff(bindingSource.bytes.toString("utf8"));
    assert.equal(fixtureBindingsWithoutCanonicalHandoff(stripped.source).source, stripped.source,
      "Removing a copied admission must be idempotent");
    context.diagnostic("Read-only selected snapshot: " + sourceFiles.size + " files, " + snapshotBytes
      + " bytes; removed " + stripped.removedSubjects.length + " copied admission/input subjects in memory only.");
  }
  await mkdir(resolve(sourceRoot, ".usf/tmp"), { recursive: true, mode: 0o700 });
  runDirectory = await mkdtemp(resolve(sourceRoot, ".usf/tmp/qualification-full-native-"));
  await chmod(runDirectory, 0o700);
  let passed = false;
  context.after(async () => {
    if (passed) await rm(runDirectory!, { recursive: true, force: true });
    else context.diagnostic("Failed native fixture retained: " + relative(sourceRoot, runDirectory!));
  });
  const ordinary = await materializeSnapshot("ordinary");
  await materializeRuntimeAssets(ordinary.root);
  await writeFixtureProviderInputs(ordinary.root);
  await assertNativeRouteAdmission(ordinary.root);
  context.diagnostic("Authenticated adapter/SDK runtime: " + runtimeAssets.packages.size + " packages, "
    + runtimeAssets.files.size + " independent files, " + runtimeAssets.bytes + " bytes.");
  const historicalFixture = await materializeSnapshot("handoff");
  await materializeRuntimeAssets(historicalFixture.root);
  const historicalPrepare = await installHistoricalProducer(historicalFixture);
  await writeFixtureProviderInputs(historicalFixture.root);
  await assertNativeRouteAdmission(historicalFixture.root);
  context.diagnostic("Pinned historical producer: exact " + historicalContinuationProducer.rawBytes
    + " bytes, physical mode 0664, native startup complete; no extra source path or copy limit.");
  if (preflightOnly) {
    await assertCanonicalUnchanged();
    assert.deepEqual(laneCounts, { ordinary: emptyCounts(), handoff: emptyCounts() });
    passed = true;
    return;
  }
  async function runNativeLane(ordinary: Fixture, prepareIntent: typeof prepareLinearMetadataContinuation, historical: boolean) {
  counts = laneCounts[ordinary.name];
  assert.deepEqual(counts, emptyCounts(), "Every lane starts with independent dispatch counters");
  allowFixtureContact = false;
  const authored = await authorFixture(ordinary);
  activeContribution = authored.operation;
  await initialiseCarrier(ordinary.root);

  // These unresolved comments belong to a graph-authenticated DIFFERENT issue,
  // not just a different binding spelling. Preserve them through both native
  // continuation paths; they are neither replayed nor reconciled by this work.
  const historicalStore = await LinearStateStore.open(ordinary.root);
  for (const state of ["prepared", "sent", "unknown"] as const) {
    const intent = await historicalStore.prepare({ bindingIri: historicalBindingIri,
      operation: "comment", remoteOperationId: "native-qualification-unrelated-" + state },
    canonicalDigest({ fixture: "unrelated-comment", state }) as `sha256:${string}`);
    if (state !== "prepared") await historicalStore.markSent(intent.id);
    if (state === "unknown") await historicalStore.markUnknown(intent.id);
  }
  const historicalIntents = historicalStore.intents();
  assert.deepEqual(historicalIntents.map(intent => intent.state), ["prepared", "sent", "unknown"]);
  assert.ok(historicalIntents.every(intent => intent.identity.bindingIri === historicalBindingIri));
  const historicalStatePath = ".usf/hermes/linear/state.json";
  const historicalState = await regularBytes(ordinary.root, historicalStatePath);
  assert.equal(historicalState.mode, 0o600);

  const selector: LinearBindingSelector = { repositoryRoot: ordinary.root, manifestPath: bindingManifestPath,
    bindingIri: fixtureBindingIri };
  const prepared = await prepareLinearBinding(selector);
  assert.equal(prepared.status, "PREPARED");
  allowFixtureContact = true;
  for (const taskClass of prepared.binding.unit.modelCapabilities) {
    const qualification = await probeCommandHandler({ command: "probe", repositoryRoot: ordinary.root,
      args: ["qualify", "--provider", "groq", "--model", model, "--task-class", taskClass, "--env-file", envPath] });
    assert.equal(qualification.exitCode ?? 0, 0, JSON.stringify(qualification.output));
    assert.equal(object(qualification.output, "native qualification").status, "qualified");
  }
  allowFixtureContact = false;
  const started = await beforeHermesDispatch(selector);
  assert.equal(started.status, "STARTED");
  const executionSelection = await assertNativeRouteAdmission(ordinary.root, started.binding);
  assert.ok(executionSelection, "Bound-work admission must provide the exact explicit dispatch selection");
  allowFixtureContact = true;
  counts.graphDispatches++;
  const dispatched = await graphExecuteCommand(ordinary.root, executionSelection.args, {
    observeLocalAgentCapabilities: async () => [],
    invokeCli: async () => { assert.fail("No host CLI or live provider is permitted in this SDK fixture"); },
  });
  assert.equal(dispatched.exitCode ?? 0, 0, JSON.stringify(dispatched.output));
  allowFixtureContact = false;
  const execution = object(dispatched.output, "native graph execution");
  assert.equal(execution.status, "ok");
  assert.deepEqual(execution.selectedUnits, executionSelection.selectedUnits,
    "Native execution evidence must preserve the explicit bound-work selection");
  assert.equal(typeof execution.evidenceDigest, "string");
  const settled = await afterHermesResult(selector, execution.evidenceDigest as GraphExecutionEvidenceDigest);
  assert.equal(settled.status, "SETTLED");
  const contribution = await contributionFromSettledLinearResult({ root: ordinary.root, selector,
    binding: { status: "SETTLED", binding: settled.binding } });
  const resolution = resolveCommand([contribution]);
  assert.equal(resolution.status, "resolved");
  assert.ok(resolution.candidate);
  const candidate = resolution.candidate;
  const candidateDigest = candidate.identity.artifactDigest;
  const operations = candidate.payload.operations;
  const writeSet = [...new Set(operations.map(operation => operation.path))].sort();
  const applied = await apply(ordinary.root, { candidate: {
    digest: candidateDigest, basis: candidate.basis, operations, lineage: candidate.lineage,
    scope: candidateScope(candidate.basis), writeSet,
    preimages: await deriveCandidatePreimages(ordinary.root, candidate.basis, writeSet),
  } });
  assert.equal(applied.status, "applied", JSON.stringify(applied));
  const checked = await runGraphDerivedCheck(ordinary.root, candidateDigest, validation);
  assert.equal(checked.status, "pass", JSON.stringify(checked));
  assert.ok(checked.status === "pass" && typeof checked.receiptPath === "string");
  const authenticated = await authenticateCandidateWorkspace(ordinary.root, candidateDigest);
  const capturedBindingPublication = await currentBindingPublication(ordinary.root);
  assert.equal(await prepareIntent(ordinary.root, settled, candidateDigest, [checked.receiptPath]), true);
  const legacy = await continuationAt(ordinary.root);
  assert.equal(legacy.pointer.schema, "urn:usf:linear-continuation-pointer:1");
  assert.equal(legacy.intent.value.schema, "urn:usf:linear-construction-continuation-intent:1");
  assert.equal(legacy.intent.value.workspaceIdentityDigest, authenticated.workspaceIdentityDigest,
    "The v1 producer retains the individual member identity");
  assert.equal(legacy.state.value.integration, null);
  assert.equal(legacy.state.value.nextStep, 0);
  assert.ok(Array.isArray(legacy.intent.value.beforeFiles));
  const capturedInputs = legacy.intent.value.beforeFiles.map(file => object(file, "input"));
  if (historical) {
    assert.equal(capturedInputs.some(file => file.path === bindingAuthoritySource), false,
      "The exact historical producer must naturally retain the uncaptured binding publication boundary");
    assert.equal(capturedInputs.some(file => file.path === carrierOnlyPath), false,
      "Carrier-tracked but uncaptured files must not be represented as absent");
    assert.deepEqual(capturedInputs.find(file => file.path === runtimePath), {
      path: runtimePath, digest: historicalContinuationProducer.rawDigest, mode: historicalContinuationProducer.mode,
    }, "The historical intent must authenticate the exact executed producer bytes and physical mode");
    assert.ok(Array.isArray(legacy.intent.value.repositoryDirtyFiles));
    assert.equal(legacy.intent.value.repositoryDirtyFiles.some(file =>
      object(file, "dirty baseline input").path === bindingAuthoritySource), false,
      "Current-authority-only admission must not override a historical dirty-baseline fact");
  } else {
    for (const fact of [capturedBindingPublication.source, capturedBindingPublication.publicationReceipt]) {
      assert.deepEqual(capturedInputs.find(file => file.path === fact.path), fact,
        "Future native capture must retain the complete active binding publication identity: " + fact.path);
    }
    assert.ok(capturedInputs.some(file => file.path === selections[1]!.manifestPath),
      "Future capture must retain the binding-work authority manifest");
  }
  context.diagnostic(ordinary.name + " native intent: " + capturedInputs.length
    + " captured files; binding publication " + (historical ? "historically uncaptured" : "fully captured") + ".");

  const integrated = await integrateCommandHandler({ command: "integrate", repositoryRoot: ordinary.root,
    args: ["--candidate", candidateDigest] }, {
    prepareCandidateIntegration,
    integrateCandidates: async (...args) => {
      counts.integrations++;
      assert.equal(counts.integrations, 1, "Every native integration invocation is counted");
      return integrateCandidates(...args);
    },
  });
  assert.equal(integrated.exitCode ?? 0, 0, JSON.stringify(integrated.output));
  const recovery = await inspectCandidateIntegrationRecovery(ordinary.root, { candidateDigests: [candidateDigest] });
  assert.equal(recovery.state, "primary-advanced");
  assert.ok(recovery.observation && recovery.prepared);
  const integration = recovery.observation;
  assert.equal(integration.outcome, "urn:usf:outcome:integration-success");
  assert.equal(integration.workspaceIdentityDigest, canonicalDigest([authenticated.workspaceIdentityDigest]),
    "Native integration records the ordered cohort digest, even for one member");
  assert.notEqual(integration.workspaceIdentityDigest, authenticated.workspaceIdentityDigest);
  const integrationIntent = JSON.parse(await readFile(resolve(ordinary.root, recovery.prepared.intentPath), "utf8")) as {
    observationPath: string;
  };
  const integrationReceipt = await readFile(resolve(ordinary.root, integrationIntent.observationPath));
  assert.equal(integrationReceipt.toString("utf8"), canonicalJson(integration) + "\n");
  assert.equal(await readFile(resolve(ordinary.root, helpPath), "utf8"), authored.expectedHelp);
  assert.deepEqual((await continuationAt(ordinary.root)).pointer, legacy.pointer);
  const handoffRoot = ordinary.root;
  let expectedCurrentPublication: Awaited<ReturnType<typeof currentBindingPublication>> | undefined;
  context.diagnostic(ordinary.name + " native integration: " + integration.observationDigest
    + "; candidate=" + candidateDigest + "; delivery=1, dispatch=1, integration=1.");

  async function assertPredecessorUnchanged(root: string): Promise<void> {
    assert.deepEqual((await LinearStateStore.open(root)).intents(), historicalIntents);
    const retainedHistory = await regularBytes(root, historicalStatePath);
    assert.deepEqual(retainedHistory.bytes, historicalState.bytes,
      "Different-issue prepared, sent and unknown intents must remain byte-for-byte unchanged");
    assert.equal(retainedHistory.mode, historicalState.mode);
    for (const file of [...legacy.intent.files, ...legacy.state.files]) {
      const current = await regularBytes(root, file.path);
      assert.deepEqual(current.bytes, file.bytes);
      assert.equal(current.mode, file.mode);
    }
    assert.deepEqual(await readFile(resolve(root, integrationIntent.observationPath)), integrationReceipt);
    assert.equal(digest(await readFile(resolve(root, acceptancePath))), acceptanceDigest);
  }
  async function assertCompleted(root: string, repaired = false): Promise<void> {
    const completed = await resumeLinearDeliveryContinuation(root);
    assert.equal(completed?.status, "completed");
    assert.equal(completed?.bindingIri, fixtureBindingIri);
    assert.equal(completed?.candidateDigest, candidateDigest);
    const terminal = await continuationAt(root);
    assert.equal(terminal.pointer.schema, "urn:usf:linear-continuation-pointer:" + (repaired ? "2" : "1"));
    if (repaired) {
      assert.ok(terminal.handoff);
      assert.equal(terminal.handoff.value.predecessorIntentDigest, legacy.pointer.intentDigest);
      assert.equal(terminal.handoff.value.predecessorStateDigest, legacy.pointer.stateDigest);
      assert.notEqual(terminal.pointer.intentDigest, legacy.pointer.intentDigest);
      assert.ok(Array.isArray(terminal.handoff.value.publicationReceipts));
      assert.equal(terminal.handoff.value.publicationReceipts.length, 4,
        "handoff authenticates selected and controller receipts plus the complete two-receipt binding publication chain");
      assert.ok(terminal.handoff.value.adoptedPending,
        "the selected-work grant published for handoff is adopted, not replayed");
      assert.ok(expectedCurrentPublication);
      const currentInputs = terminal.handoff.value.currentAuthorityInputs;
      assert.ok(Array.isArray(currentInputs));
      assert.equal(currentInputs.length, 1);
      const currentInput = object(currentInputs[0], "current-authority-only publication input");
      const expectedIdentity = {
        disposition: "current-authority-only", historicalEquivalence: "not-claimed", ...expectedCurrentPublication,
      };
      assert.deepEqual(Object.keys(currentInput).sort(),
        [...Object.keys(expectedIdentity), "selectedDependencyIndependenceDigest"].sort());
      const { selectedDependencyIndependenceDigest, ...identity } = currentInput;
      assert.ok(typeof selectedDependencyIndependenceDigest === "string");
      assert.match(selectedDependencyIndependenceDigest, /^sha256:[a-f0-9]{64}$/u);
      assert.deepEqual(identity, expectedIdentity,
        "Every admitted current source, receipt and authority identity must match independent native observations");
      const successorAdmission = object(terminal.intent.value.repairHandoff, "successor repair admission");
      assert.deepEqual(successorAdmission.currentAuthorityInputs, currentInputs);
      for (const fact of [expectedCurrentPublication.source, expectedCurrentPublication.publicationReceipt]) {
        const actual = await regularBytes(root, fact.path);
        assert.deepEqual({ path: fact.path, digest: actual.digest, mode: actual.mode }, fact,
          "Known child publications must not replace the admitted current binding authority input");
      }
    } else assert.equal(terminal.pointer.intentDigest, legacy.pointer.intentDigest);
    assert.equal(terminal.state.value.nextStep, 3);
    assert.equal(terminal.state.value.terminal, true);
    assert.ok(Array.isArray(terminal.state.value.completedEffects));
    assert.deepEqual(terminal.state.value.completedEffects.map(effect =>
      object(object(effect, "effect").effect, "publication").kind), ["construction", "completion", "construction"]);
    assert.equal(selectedPacket(root, selections[0]!).realisationStage?.completion.verified, true);
    assert.equal(selectedPacket(root, controller).eligibility?.construction.eligible, true);
    assert.equal((await observeLinearBinding({ ...selector, repositoryRoot: root })).status, "COMPLETED");
    await assertPredecessorUnchanged(root);
    const pointer = canonicalJson(terminal.pointer);
    assert.equal(await resumeLinearDeliveryContinuation(root), null);
    assert.equal(canonicalJson((await continuationAt(root)).pointer), pointer);
    assert.deepEqual({ delivery: counts.deliveryRequests, dispatch: counts.graphDispatches, integrations: counts.integrations },
      { delivery: 1, dispatch: 1, integrations: 1 });
  }
  if (!historical) {
    await assertCompleted(ordinary.root);
    activeContribution = undefined;
    context.diagnostic("Ordinary current-producer completion/currentness/no-replay passed: delivery=1, dispatch=1, integration=1.");
    return { candidateDigest, observationDigest: integration.observationDigest,
      terminalPointer: (await continuationAt(ordinary.root)).pointer };
  }

  const repairPaths = [runtimePath, vocabularyPath, carrierOnlyPath, bindingGraphPath];
  const preimages = new Map<string, Awaited<ReturnType<typeof regularBytes>>>();
  for (const path of repairPaths) preimages.set(path, await regularBytes(handoffRoot, path));
  assert.equal(preimages.get(runtimePath)!.digest, historicalContinuationProducer.rawDigest);
  assert.equal(preimages.get(runtimePath)!.mode, historicalContinuationProducer.mode);
  const currentRuntime = sourceFiles.get(runtimePath)!;
  assert.notEqual(currentRuntime.digest, historicalContinuationProducer.rawDigest,
    "Historical acceptance requires a genuine upgrade to the repaired current runtime");
  copiedBytes += currentRuntime.bytes.length;
  assert.ok(copiedBytes <= 128 * 1024 * 1024, "Runtime upgrade shares the unchanged fixture copy budget");
  await writeExact(handoffRoot, runtimePath, currentRuntime.bytes, currentRuntime.mode);
  await writeExact(handoffRoot, carrierOnlyPath,
    preimages.get(carrierOnlyPath)!.bytes.toString("utf8") + "\n// Disposable carrier-only repair input.\n",
    preimages.get(carrierOnlyPath)!.mode);
  const sourceVocabulary = preimages.get(vocabularyPath)!;
  assert.ok(sourceVocabulary.bytes.toString("utf8").endsWith("\n"));
  await writeExact(handoffRoot, vocabularyPath, sourceVocabulary.bytes.toString("utf8")
    + authored.addedVocabulary.join("\n") + "\n", sourceVocabulary.mode);
  await assert.rejects(resumeLinearDeliveryContinuation(handoffRoot), error => {
    const reason = error !== null && typeof error === "object" && "reasonCode" in error ? error.reasonCode : null;
    assert.equal(reason, "LINEAR_CONTINUATION_UNRELATED_CHANGE",
      "Source drift must refuse before an explicit repair admission");
    return true;
  });
  assert.deepEqual((await continuationAt(handoffRoot)).pointer, legacy.pointer);
  await assertPredecessorUnchanged(handoffRoot);

  const graphIri = "urn:usf:graph:linear-issue-bindings";
  const rows: string[] = [];
  const quad = (subject: string, name: string, value: string, iri = false): void => {
    rows.push("<" + subject + "> <" + predicate(name) + "> " + (iri ? "<" + value + ">" : JSON.stringify(value))
      + " <" + graphIri + "> .");
  };
  quad(handoffPolicy, "type", "urn:usf:type:ConstructionContinuationRepairAdmission", true);
  quad(handoffPolicy, "version", "1");
  quad(handoffPolicy, "forContract", "urn:usf:contract:hermes-linear-autonomy:1", true);
  quad(handoffPolicy, "forPolicy", continuationPolicy, true);
  quad(handoffPolicy, "failureClass", "WORKSPACE_IDENTITY_MEMBER_COHORT_MISMATCH");
  quad(handoffPolicy, "predecessorIntentDigest", legacy.pointer.intentDigest as string);
  quad(handoffPolicy, "predecessorStateDigest", legacy.pointer.stateDigest as string);
  quad(handoffPolicy, "integrationObservationDigest", integration.observationDigest);
  quad(handoffPolicy, "currentAuthorityOnlyPublicationSource", bindingAuthoritySource);
  for (const [index, path] of repairPaths.entries()) {
    const subject = "urn:usf:repair-input:native-qualification:" + index;
    const before = preimages.get(path)!;
    const after = await regularBytes(handoffRoot, path);
    quad(handoffPolicy, "approvedRepairInput", subject, true);
    quad(subject, "type", "urn:usf:type:ConstructionContinuationRepairInput", true);
    quad(subject, "repositoryPath", path);
    quad(subject, "preimageDigest", before.digest);
    quad(subject, "preimageMode", String(before.mode));
    if (path !== bindingGraphPath) quad(subject, "postimageDigest", after.digest);
    quad(subject, "postimageMode", String(after.mode));
  }
  const oldBindings = preimages.get(bindingGraphPath)!;
  assert.ok(oldBindings.bytes.toString("utf8").endsWith("\n"));
  await writeExact(handoffRoot, bindingGraphPath, oldBindings.bytes.toString("utf8") + rows.join("\n") + "\n", oldBindings.mode);
  // This is a genuine disposable controller publication, not an invented
  // future output hash. Continuation's three child steps may then stale this
  // admission basis, and must be authenticated as the declared bounded chain.
  await publishConstruction(handoffRoot, selections[0]!);
  await publishConstruction(handoffRoot, selections[1]!);
  await publishConstruction(handoffRoot, controller);
  expectedCurrentPublication = await currentBindingPublication(handoffRoot);
  const selectedCurrent = selectedPacket(handoffRoot, selections[0]!);
  assert.equal(selectedCurrent.readSet.includes(bindingAuthoritySource), false);
  assert.equal(selectedCurrent.writeSet.includes(bindingAuthoritySource), false);
  assert.equal(selectedCurrent.realisationBasis!.work.dependencies.some(dependency =>
    dependency.key === bindingAuthoritySource), false,
    "Current binding authority must be independent of the selected qualification dependency closure");
  await assertCompleted(handoffRoot, true);
  activeContribution = undefined;
  context.diagnostic("Historical native handoff/completion/currentness/no-replay passed; current authority only, historical equivalence not claimed.");
  return { candidateDigest, observationDigest: integration.observationDigest,
    terminalPointer: (await continuationAt(handoffRoot)).pointer };
  }

  const currentResult = await runNativeLane(ordinary, prepareLinearMetadataContinuation, false);
  const historicalResult = await runNativeLane(historicalFixture, historicalPrepare, true);
  assert.notEqual(currentResult.candidateDigest, historicalResult.candidateDigest,
    "The historical lane must produce its own genuine candidate and check");
  assert.notEqual(currentResult.observationDigest, historicalResult.observationDigest,
    "The historical lane must produce its own genuine integration observation");
  assert.deepEqual((await continuationAt(ordinary.root)).pointer, currentResult.terminalPointer,
    "Historical repair must leave the completed ordinary lane untouched");
  for (const lane of Object.values(laneCounts)) {
    assert.deepEqual({ delivery: lane.deliveryRequests, dispatch: lane.graphDispatches, integrations: lane.integrations },
      { delivery: 1, dispatch: 1, integrations: 1 });
  }
  await assertCanonicalUnchanged();
  context.diagnostic("Two independent native lanes completed: total delivery=2, dispatch=2, integration=2; continuation and replay add zero.");
  passed = true;
}
