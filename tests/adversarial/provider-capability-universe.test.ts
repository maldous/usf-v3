import assert from "node:assert/strict";
import { access, copyFile, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { canonicalDigest } from "../../src/core/canonical.ts";
import { loadSemanticGraph } from "../../src/graph/index.ts";
import {
  capabilityKind, observedModelFeatureCapabilities, observeQualifiedTaskClasses,
  splitCapabilityRequirement, satisfiesCapabilities, taskClassCapabilities,
  unmetCapabilities,
} from "../../src/providers/capabilities.ts";
import { antigravityCliArguments, claudeCliArguments, codexModelSelection } from "../../src/providers/cli-transports.ts";
import { projectEconomics, readGraphDerivedEconomics } from "../../src/providers/economics-projection.ts";
import {
  answerDigest, createQualificationPolicy, createQualificationSuite, promptDigest,
  qualifySemanticProfile, sealQualificationObservation,
  type QualificationAgentProfile, type QualificationObservation,
  type QualificationPolicySnapshot, type QualificationSuiteSnapshot,
  type SemanticQualificationResult,
} from "../../src/providers/qualification.ts";
import { deriveRouteUniverse } from "../../src/providers/route-universe.ts";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const authoritySourceRoot = await access(resolve(repositoryRoot, "graph/manifests/v3-convention.json"))
  .then(() => repositoryRoot)
  .catch(() => fileURLToPath(new URL("../../../../../", import.meta.url)));

/**
 * Adversarial proof for the shared capability vocabulary.
 *
 * The defect this closes was invisible rather than loud. Work packets declared
 * `modelCapability` across nine task classes; the catalogue described models
 * with five model features; the two sets did not intersect at all. Nothing
 * translated between them, so a work unit requiring `typescript` could never
 * have matched a route. It went unnoticed because the dispatcher read a third
 * predicate the graph does not contain, leaving the requirement permanently
 * empty -- and an empty requirement refuses nothing, so a router that could not
 * match a capability looked exactly like a router with nothing to match.
 *
 * The property under test is therefore not "capabilities match". It is that a
 * capability is satisfied only by its own kind of evidence, and that every way
 * of failing to satisfy one is distinguishable from success. A vocabulary that
 * silently accepts an unknown name has the same failure mode as the bug it
 * replaced.
 */

const evidence = (modelFeatures: readonly string[], qualifiedTaskClasses: readonly string[]) =>
  ({ modelFeatures, qualifiedTaskClasses });

test("the two vocabularies do not intersect, which is why a join was needed", () => {
  const overlap = (observedModelFeatureCapabilities as readonly string[]).filter((name) =>
    (taskClassCapabilities as readonly string[]).includes(name));
  assert.deepEqual(overlap, [], "a name in both vocabularies would make its evidence ambiguous");
});

test("task classes are the closed half and everything else is a model feature", () => {
  assert.equal(capabilityKind("typescript"), "task-class");
  assert.equal(capabilityKind("tool-call"), "model-feature");
  // A feature models.dev has not published yet, and a plain typo, are both
  // model features. Neither is admitted by that: each is matched against the
  // model's own catalogue entry and refuses when absent. Treating an
  // unrecognised name as its own category needed a hardcoded feature list,
  // which would have refused the entire catalogue the day a feature was added.
  assert.equal(capabilityKind("vision"), "model-feature");
  assert.equal(capabilityKind("tool-calll"), "model-feature");
  // Task-class membership is exact: a near-miss is not a task class, so it can
  // never be satisfied by a qualification record.
  assert.equal(capabilityKind("TypeScript"), "model-feature");
  assert.equal(capabilityKind(" typescript"), "model-feature");
});

test("a requirement is split by vocabulary, deduplicated and ordered", () => {
  const split = splitCapabilityRequirement(["typescript", "tool-call", "vision", "typescript"]);
  assert.deepEqual(split.modelFeatures, ["tool-call", "vision"]);
  assert.deepEqual(split.taskClasses, ["typescript"]);
});

test("a model feature is satisfied by catalogue evidence and nothing else", () => {
  assert.ok(satisfiesCapabilities(["tool-call"], evidence(["tool-call"], [])));
  const unmet = unmetCapabilities(["tool-call"], evidence([], ["typescript", "node-test"]));
  assert.deepEqual(unmet.missingModelFeatures, ["tool-call"],
    "earning every task class must not supply a model feature");
});

test("a task class is satisfied by qualification and nothing else", () => {
  assert.ok(satisfiesCapabilities(["typescript"], evidence([], ["typescript"])));
  const unmet = unmetCapabilities(["typescript"], evidence([...observedModelFeatureCapabilities], []));
  assert.deepEqual(unmet.unqualifiedTaskClasses, ["typescript"],
    "holding every catalogue feature must not supply a task class");
});

test("neither vocabulary can borrow the other's evidence, in either direction", () => {
  // The single property the whole split exists to guarantee. A route that is
  // strong on one axis and absent on the other must fail on the absent one.
  const featuresOnly = evidence([...observedModelFeatureCapabilities], []);
  const classesOnly = evidence([], [...taskClassCapabilities]);
  assert.equal(satisfiesCapabilities(["typescript"], featuresOnly), false);
  assert.equal(satisfiesCapabilities(["tool-call"], classesOnly), false);
});

test("a capability nothing advertises refuses and is never silently satisfied", () => {
  // The bug's own shape: a requirement that matches nothing must refuse, not
  // pass. A route holding every observed feature and every task class still
  // fails a name it does not hold, and fails it as a missing model feature
  // rather than being waved through.
  const everything = evidence([...observedModelFeatureCapabilities], [...taskClassCapabilities]);
  assert.equal(satisfiesCapabilities(["invented-capability"], everything), false);
  assert.deepEqual(
    unmetCapabilities(["invented-capability"], everything).missingModelFeatures,
    ["invented-capability"],
  );
});

test("an empty requirement is satisfied by an empty route", () => {
  // Not a permissive default by accident: requiring nothing is a real request
  // and must succeed, or every unconstrained dispatch would refuse.
  assert.ok(satisfiesCapabilities([], evidence([], [])));
});

test("every task class the graph's work packets declare is in the vocabulary", () => {
  // The vocabulary is closed, so a packet naming a class it does not contain
  // would refuse every route. These are the nine the graph actually declares.
  for (const declared of ["typescript", "node-test", "provider-routing", "rdf-semantics",
    "cli-design", "semantic-evaluation", "process-lifecycle", "technical-writing", "semantic-review"]) {
    assert.equal(capabilityKind(declared), "task-class", `${declared} must be a known task class`);
  }
});

// ---- stored qualification records -------------------------------------------

const qualificationConfig = JSON.parse(
  await readFile(resolve(authoritySourceRoot, "config/qualification.json"), "utf8"),
) as {
  suite: Parameters<typeof createQualificationSuite>[0];
  policy: Parameters<typeof createQualificationPolicy>[0];
};
const currentSuite = createQualificationSuite(qualificationConfig.suite);
const currentPolicy = createQualificationPolicy(qualificationConfig.policy);
const currentEconomics = readGraphDerivedEconomics(
  JSON.parse(await readFile(resolve(authoritySourceRoot, "config/execution-economics.json"), "utf8")) as unknown,
  loadSemanticGraph(authoritySourceRoot, "graph/manifests/v3-convention.json"),
);

const pastEvaluation = "2000-01-01T00:01:00.000Z";
const route = Object.freeze({ provider: "groq", model: "qwen/qwen3.6-27b" });
const exactGraphFiles = Object.freeze([
  "graph/manifests/v3-convention.json",
  "graph/manifests/v3-execution.json",
  "graph/manifests/self-host.json",
  "graph/manifest.json",
  "graph/foundation.nq",
  "graph/usf-bootstrap.nq",
  "graph/semantic-first.nq",
  "graph/v3-execution.nq",
  "graph/v3-convention.nq",
]);

interface QualificationFixture {
  readonly record: Readonly<Record<string, unknown>>;
  readonly observations: readonly QualificationObservation[];
  readonly invocations: readonly Readonly<Record<string, unknown>>[];
  readonly result: SemanticQualificationResult;
}

const passingAnswers: Readonly<Record<string, string>> = Object.freeze({
  "typescript-readonly-contract": "readonly",
  "typescript-two-layer-validation": "runtime validation and type checking",
  "typescript-bounded-result": JSON.stringify({ files: [], risk: "bounded" }),
  "typescript-authorized-scope": "smallest",
  "cli-plan-operator-intent": "intent",
  "cli-foreground-lifecycle": "foreground",
  "cli-structured-invocation": JSON.stringify({ command: "node", arguments: ["--test"] }),
  "cli-reusable-command-boundary": "registered command, no ad hoc script",
});

function recordFromResult(
  result: SemanticQualificationResult,
  observations: readonly QualificationObservation[],
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    schema: "urn:usf:qualification-record:1",
    status: "ok",
    role: result.derivedRoles[0] ?? "UNQUALIFIED",
    taskClass: result.taskClass,
    route: Object.freeze({ provider: result.profile.actual.provider, model: result.profile.requested.model }),
    qualificationDigest: result.qualificationDigest,
    observationSetDigest: result.inputs.observationSetDigest,
    observations: Object.freeze([...observations]),
    qualification: result,
  });
}

function qualificationFixture(overrides: Readonly<{
  route?: Readonly<{ provider: string; model: string }>;
  taskClass?: string;
  suite?: QualificationSuiteSnapshot;
  policy?: QualificationPolicySnapshot;
  effectivePolicyDigest?: string;
  answers?: Readonly<Record<string, string>>;
  evidenceOverrides?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  evaluatedAt?: string;
}> = {}): QualificationFixture {
  const selectedRoute = overrides.route ?? route;
  const taskClass = overrides.taskClass ?? "typescript";
  const suite = overrides.suite ?? currentSuite;
  const policy = overrides.policy ?? currentPolicy;
  const effectivePolicyDigest = overrides.effectivePolicyDigest ?? currentEconomics.closureDigest;
  const evaluatedAt = overrides.evaluatedAt ?? pastEvaluation;
  const adapter = `@ai-sdk/${selectedRoute.provider}`;
  const profile: QualificationAgentProfile = Object.freeze({
    schema: "urn:usf:agent-profile:1",
    provider: selectedRoute.provider,
    requestedModel: selectedRoute.model,
    adapter,
    adapterVersion: "1.0.0",
    adapterLockDigest: canonicalDigest({ adapter, version: "1.0.0" }, { rejectAbsolutePaths: true }),
    authMode: "api_token",
    toolProfile: "qualification-no-tools",
    toolProfileDigest: canonicalDigest({ toolProfile: "qualification-no-tools" }, { rejectAbsolutePaths: true }),
    promptVersion: "suite-declared-prompts",
    promptDigest: canonicalDigest({ promptVersion: "suite-declared-prompts" }, { rejectAbsolutePaths: true }),
    contextConfig: "suite-case-prompt-only",
    contextConfigDigest: canonicalDigest({ contextConfig: "suite-case-prompt-only" }, { rejectAbsolutePaths: true }),
    outputConfig: "bounded-text",
    outputConfigDigest: canonicalDigest({ outputConfig: "bounded-text" }, { rejectAbsolutePaths: true }),
  });
  const cases = suite.corpus.cases.filter((item) => item.taskClass === taskClass);
  const observations: QualificationObservation[] = [];
  const invocations: Readonly<Record<string, unknown>>[] = [];
  for (const [index, item] of cases.entries()) {
    const answer = overrides.answers?.[item.caseId] ?? passingAnswers[item.caseId];
    if (answer === undefined) throw new Error(`NO_OFFLINE_ANSWER:${item.caseId}`);
    const startedAt = new Date(Date.parse("2000-01-01T00:00:00.000Z") + index * 2_000).toISOString();
    const completedAt = new Date(Date.parse(startedAt) + 1_000).toISOString();
    const usage = Object.freeze({ inputTokens: 10 + index, outputTokens: 2, totalTokens: 12 + index });
    const evidence = Object.freeze({
      schema: "urn:usf:qualification-invocation-evidence:1",
      provider: selectedRoute.provider,
      requestedModel: selectedRoute.model,
      actualModel: selectedRoute.model,
      transport: "vercel-ai-sdk",
      adapterPackage: profile.adapter,
      adapterVersion: profile.adapterVersion,
      adapterLockDigest: profile.adapterLockDigest,
      suiteId: suite.corpus.corpusId,
      suiteVersion: suite.suiteVersion,
      caseId: item.caseId,
      prompt: item.prompt,
      answer,
      startedAt,
      completedAt,
      latencyMs: 1_000,
      usage,
      ...(overrides.evidenceOverrides?.[item.caseId] ?? {}),
    });
    const evidenceDigest = canonicalDigest(evidence, { rejectAbsolutePaths: true });
    invocations.push(Object.freeze({ ...evidence, evidenceDigest }));
    observations.push(sealQualificationObservation({
      schema: "urn:usf:qualification-observation:1",
      provider: selectedRoute.provider,
      requestedModel: selectedRoute.model,
      actualModel: selectedRoute.model,
      transport: "vercel-ai-sdk",
      adapterPackage: profile.adapter,
      adapterVersion: profile.adapterVersion,
      adapterLockDigest: profile.adapterLockDigest,
      caseId: item.caseId,
      promptDigest: promptDigest(item.prompt),
      answer,
      answerDigest: answerDigest(answer),
      executionEvidenceDigest: evidenceDigest,
      observedAt: completedAt,
      latencyMs: 1_000,
      usage,
    }));
  }
  const result = qualifySemanticProfile({
    profile, taskClass, suite, policy, effectivePolicyDigest,
    observations, evaluatedAt,
  });
  return Object.freeze({
    record: recordFromResult(result, observations),
    observations: Object.freeze(observations),
    invocations: Object.freeze(invocations),
    result,
  });
}

async function authorityRepository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "usf-qualification-"));
  for (const relativePath of exactGraphFiles) {
    const target = resolve(root, relativePath);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(resolve(authoritySourceRoot, relativePath), target);
  }
  await mkdir(resolve(root, "config"), { recursive: true });
  for (const name of ["qualification.json", "execution-economics.json"]) {
    await copyFile(resolve(authoritySourceRoot, "config", name), resolve(root, "config", name));
  }
  return root;
}

async function repositoryWith(
  fixtures: readonly QualificationFixture[],
  options: Readonly<{ omitInvocationDigest?: string }> = {},
): Promise<string> {
  const root = await authorityRepository();
  const qualificationDirectory = resolve(root, ".usf", "qualifications");
  const invocationDirectory = resolve(root, ".usf", "qualification-invocations");
  await mkdir(qualificationDirectory, { recursive: true, mode: 0o700 });
  await mkdir(invocationDirectory, { recursive: true, mode: 0o700 });
  for (const fixture of fixtures) {
    const digest = String(fixture.record.qualificationDigest);
    await writeFile(resolve(qualificationDirectory, `${digest.slice("sha256:".length)}.json`),
      `${JSON.stringify(fixture.record, null, 2)}\n`, { mode: 0o600 });
    for (const evidence of fixture.invocations) {
      if (evidence.evidenceDigest === options.omitInvocationDigest) continue;
      const evidenceDigest = String(evidence.evidenceDigest);
      await writeFile(resolve(invocationDirectory, `${evidenceDigest.slice("sha256:".length)}.json`),
        `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
    }
  }
  return root;
}

function withRecord(
  fixture: QualificationFixture,
  record: Readonly<Record<string, unknown>>,
): QualificationFixture {
  return Object.freeze({ ...fixture, record });
}

test("a canonical offline record grants exactly its replayed task class to its route", async () => {
  const fixture = qualificationFixture();
  assert.equal(fixture.result.status, "qualified");
  const observed = await observeQualifiedTaskClasses(await repositoryWith([fixture]));
  assert.deepEqual([...observed.byRoute.keys()], ["groq:qwen/qwen3.6-27b"]);
  assert.deepEqual(observed.byRoute.get("groq:qwen/qwen3.6-27b"), ["typescript"]);
});

test("elapsed time alone does not withdraw a canonically replayed qualification", async () => {
  const fixture = qualificationFixture({ evaluatedAt: pastEvaluation });
  assert.ok(Date.parse(fixture.result.validUntil) < Date.now());
  const observed = await observeQualifiedTaskClasses(await repositoryWith([fixture]));
  assert.deepEqual(observed.byRoute.get("groq:qwen/qwen3.6-27b"), ["typescript"]);
  assert.equal(observed.supersededCount, 0, "age is not supersession");
});

test("a record earned under another suite or corpus is superseded", async () => {
  const wrongSuite = createQualificationSuite({ ...qualificationConfig.suite, suiteVersion: "1.1.1" });
  const changedCases = qualificationConfig.suite.cases.map((item, index) =>
    index === 0 ? { ...item, prompt: `${item.prompt} changed` } : item);
  const wrongCorpus = createQualificationSuite({ ...qualificationConfig.suite, cases: changedCases });
  for (const fixture of [qualificationFixture({ suite: wrongSuite }), qualificationFixture({ suite: wrongCorpus })]) {
    const observed = await observeQualifiedTaskClasses(await repositoryWith([fixture]));
    assert.equal(observed.byRoute.size, 0);
    assert.equal(observed.supersededCount, 1);
  }
});

test("a record earned under another qualification policy is superseded", async () => {
  const wrongPolicy = createQualificationPolicy({ ...qualificationConfig.policy, policyVersion: "1.1.1" });
  const observed = await observeQualifiedTaskClasses(
    await repositoryWith([qualificationFixture({ policy: wrongPolicy })]));
  assert.equal(observed.byRoute.size, 0);
  assert.equal(observed.supersededCount, 1);
});

test("a changed current execution-economics policy supersedes the stored replay", async () => {
  const fixture = qualificationFixture();
  const root = await repositoryWith([fixture]);
  const graphPath = resolve(root, "graph/v3-execution.nq");
  const before = '<urn:usf:economic-policy:zero-paid:1> <urn:usf:predicate:maximumPaidCostUsd> "0" <urn:usf:graph:v3-execution> .';
  const after = '<urn:usf:economic-policy:zero-paid:1> <urn:usf:predicate:maximumPaidCostUsd> "0.25" <urn:usf:graph:v3-execution> .';
  const graphBytes = await readFile(graphPath, "utf8");
  assert.ok(graphBytes.includes(before));
  await writeFile(graphPath, graphBytes.replace(before, after), "utf8");
  const changedProjection = projectEconomics(loadSemanticGraph(root, "graph/manifests/v3-convention.json"));
  await writeFile(resolve(root, "config/execution-economics.json"),
    `${JSON.stringify(changedProjection, null, 2)}\n`, "utf8");
  const observed = await observeQualifiedTaskClasses(root);
  assert.equal(observed.byRoute.size, 0);
  assert.equal(observed.supersededCount, 1);
});

test("a legacy record without durable observations grants nothing", async () => {
  const fixture = qualificationFixture();
  const { observations: _observations, ...legacy } = fixture.record;
  const observed = await observeQualifiedTaskClasses(
    await repositoryWith([withRecord(fixture, legacy)]));
  assert.equal(observed.byRoute.size, 0);
  assert.equal(observed.recordCount, 1);
  assert.equal(observed.supersededCount, 0);
});

test("a missing durable invocation record grants nothing", async () => {
  const fixture = qualificationFixture();
  const omitted = fixture.observations[0]!.executionEvidenceDigest;
  const observed = await observeQualifiedTaskClasses(
    await repositoryWith([fixture], { omitInvocationDigest: omitted }));
  assert.equal(observed.byRoute.size, 0);
});

test("content-addressed invocation evidence must still bind route, prompt and answer", async () => {
  const caseId = "typescript-readonly-contract";
  for (const changedEvidence of [
    { provider: "cohere" },
    { prompt: "Name an unrelated modifier." },
    { answer: "mutable" },
    { caseId: "typescript-two-layer-validation" },
  ]) {
    const fixture = qualificationFixture({ evidenceOverrides: { [caseId]: changedEvidence } });
    assert.equal(fixture.result.status, "qualified",
      "the pure grader cannot inspect the durable invocation record");
    const observed = await observeQualifiedTaskClasses(await repositoryWith([fixture]));
    assert.equal(observed.byRoute.size, 0,
      "a correctly rehashed evidence file cannot transfer another invocation into this case");
  }
});

test("an invocation file whose content no longer matches its digest grants nothing", async () => {
  const fixture = qualificationFixture();
  const first = fixture.invocations[0]!;
  const tampered = Object.freeze({ ...first, answer: "tampered after persistence" });
  const changed = Object.freeze({
    ...fixture,
    invocations: Object.freeze([tampered, ...fixture.invocations.slice(1)]),
  });
  const observed = await observeQualifiedTaskClasses(await repositoryWith([changed]));
  assert.equal(observed.byRoute.size, 0);
});

test("a qualification cannot be indexed under a sibling route", async () => {
  const fixture = qualificationFixture();
  const crossRoute = { ...fixture.record, route: { provider: route.provider, model: "openai/gpt-oss-120b" } };
  const observed = await observeQualifiedTaskClasses(
    await repositoryWith([withRecord(fixture, crossRoute)]));
  assert.equal(observed.byRoute.size, 0);
});

test("a rehashed wrong score cannot override unmodified invocation observations", async () => {
  const actual = qualificationFixture({ answers: { "typescript-readonly-contract": "mutable" } });
  const claimed = qualificationFixture();
  assert.equal(actual.result.status, "unqualified");
  assert.equal(claimed.result.status, "qualified");
  const { qualificationDigest: _claimedDigest, ...claimedWithoutDigest } = claimed.result;
  const forgedWithoutDigest = {
    ...claimedWithoutDigest,
    inputs: { ...claimedWithoutDigest.inputs, observationSetDigest: actual.result.inputs.observationSetDigest },
    observedAt: actual.result.observedAt,
    evaluatedAt: actual.result.evaluatedAt,
    validUntil: actual.result.validUntil,
  };
  const forgedQualification = {
    ...forgedWithoutDigest,
    qualificationDigest: canonicalDigest(forgedWithoutDigest, { rejectAbsolutePaths: true }),
  } as SemanticQualificationResult;
  const forged = withRecord(actual, recordFromResult(forgedQualification, actual.observations));
  assert.equal(forgedQualification.inputs.observationSetDigest, actual.result.inputs.observationSetDigest);
  const observed = await observeQualifiedTaskClasses(await repositoryWith([forged]));
  assert.equal(observed.byRoute.size, 0,
    "canonical replay, not a self-asserted digest, must decide the score");
});

test("the admitted current suite, corpus, policy and economics basis is inspectable", async () => {
  const observed = await observeQualifiedTaskClasses(await repositoryWith([qualificationFixture()]));
  assert.equal(observed.basis.suiteId, currentSuite.suiteId);
  assert.equal(observed.basis.suiteVersion, currentSuite.suiteVersion);
  assert.equal(observed.basis.suiteDigest, currentSuite.suiteDigest);
  assert.equal(observed.basis.corpusDigest, currentSuite.corpusDigest);
  assert.equal(observed.basis.qualificationPolicyDigest, currentPolicy.policyDigest);
  assert.equal(observed.basis.effectivePolicyDigest, currentEconomics.closureDigest);
});

test("UNQUALIFIED is a recorded replay result and not a capability", async () => {
  const fixture = qualificationFixture({ answers: { "typescript-readonly-contract": "mutable" } });
  assert.equal(fixture.result.status, "unqualified");
  const observed = await observeQualifiedTaskClasses(await repositoryWith([fixture]));
  assert.equal(observed.byRoute.size, 0);
});

test("a failed top-level status or task-class masquerade grants nothing", async () => {
  const fixture = qualificationFixture();
  for (const record of [
    { ...fixture.record, status: "failed" },
    { ...fixture.record, taskClass: "not-a-task-class" },
    { ...fixture.record, route: { provider: "groq" } },
  ]) {
    const observed = await observeQualifiedTaskClasses(
      await repositoryWith([withRecord(fixture, record)]));
    assert.equal(observed.byRoute.size, 0);
  }
});

test("a record may not grant a model feature under the guise of a task class", async () => {
  const fixture = qualificationFixture();
  const observed = await observeQualifiedTaskClasses(await repositoryWith([
    withRecord(fixture, { ...fixture.record, taskClass: "tool-call" }),
  ]));
  assert.equal(observed.byRoute.size, 0);
});

test("canonical records accumulate per route and stay sorted", async () => {
  const typescript = qualificationFixture();
  const cliDesign = qualificationFixture({ taskClass: "cli-design" });
  const sibling = qualificationFixture({
    route: { provider: "cohere", model: "north-mini-code-1-0" },
  });
  assert.equal(cliDesign.result.status, "qualified");
  const observed = await observeQualifiedTaskClasses(
    await repositoryWith([typescript, cliDesign, sibling]));
  assert.deepEqual(observed.byRoute.get("groq:qwen/qwen3.6-27b"), ["cli-design", "typescript"]);
  assert.deepEqual(observed.byRoute.get("cohere:north-mini-code-1-0"), ["typescript"]);
});

test("a repository with no qualification directory reports evaluated and empty", async () => {
  const observed = await observeQualifiedTaskClasses(await authorityRepository());
  assert.equal(observed.evaluated, true);
  assert.equal(observed.byRoute.size, 0);
  assert.equal(observed.recordCount, 0);
});

test("absent qualification or economics authority admits nothing", async () => {
  const fixture = qualificationFixture();
  const root = await mkdtemp(resolve(tmpdir(), "usf-qualification-bare-"));
  const directory = resolve(root, ".usf", "qualifications");
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, `${fixture.result.qualificationDigest.slice("sha256:".length)}.json`),
    JSON.stringify(fixture.record), "utf8");
  const observed = await observeQualifiedTaskClasses(root);
  assert.equal(observed.evaluated, true);
  assert.equal(observed.recordCount, 1);
  assert.equal(observed.byRoute.size, 0);
  assert.equal(observed.basis.corpusDigest, "");
  assert.equal(observed.basis.effectivePolicyDigest, "");
});

/**
 * Adversarial proof that the qualification gate is load-bearing on the path
 * Hermes dispatches through.
 *
 * Every property above held before this was written, and constrained nothing:
 * the map of earned task classes was an optional input, and two of the three
 * production callers of the route universe simply did not pass it -- including
 * `graph execute`, the only path `hermes implement` dispatches through. So a
 * qualification model with thirteen proven properties derived every candidate
 * with an empty earned set. The field is required now, which is why the two
 * omissions became compiler errors rather than a finding somebody had to notice.
 */
test("a task class constrains the derived universe, and its absence refuses", () => {
  const catalogueModel = {
    route: { provider: "groq", model: "m" },
    underlying: { family: "f", model: "m" },
    capabilityNames: ["reasoning"],
    cost: { input: 0, output: 0, currency: "USD", unit: "per-million-tokens" },
    limits: { context: 100_000, output: 8_000, input: null },
    modalities: { input: ["text"], output: ["text"] },
  };
  const universeInput = (qualified: ReadonlyMap<string, readonly string[]>) => ({
    snapshot: {
      schema: "urn:usf:model-catalogue:1",
      source: "models.dev/api.json",
      rawDigest: `sha256:${"a".repeat(64)}`,
      normalizedDigest: `sha256:${"b".repeat(64)}`,
      providers: [{
        providerRoute: "groq", name: "Groq",
        adapter: { package: "@ai-sdk/groq", installedVersion: "1" },
        credentialNames: ["GROQ_API_KEY"],
        models: [catalogueModel],
      }],
      denominators: {},
      nonclaims: [],
    } as unknown as Parameters<typeof deriveRouteUniverse>[0]["snapshot"],
    installedAdapterPackages: ["@ai-sdk/groq"],
    suppliedCredentialNames: ["GROQ_API_KEY"],
    authorizations: [{
      transport: "vercel-ai-sdk" as const, provider: "groq", entitlement: "free-quota",
      basis: "operator-declared-free-tier", maximumPaidCostUsd: 0,
      evidence: "documented free tier", sourceDocumentation: "https://example.invalid",
      accountBasis: "trial", permittedCostClasses: ["zero-price"], paidSpendPermitted: false,
    }],
    policy: {
      maximumPaidCost: 0, paidFallback: "prohibited", unknownPrice: "ineligible",
      acceptedCostClasses: ["free-quota", "zero-price", "subscription-included"],
    },
    requirement: { requiredCapabilities: ["typescript"], minimumContextTokens: null, minimumOutputTokens: null },
    observedAvailableRouteIds: [],
    localAgentCapabilities: [],
    qualifiedTaskClassesByRoute: qualified,
  });

  // No qualification: the model is authorized, capable and refused, because the
  // work asks for a task class this route has not earned.
  const withoutQualification = deriveRouteUniverse(universeInput(new Map()));
  assert.deepEqual(withoutQualification.candidates.map((entry) => entry.candidateId), []);

  // The exact route earns it and becomes a candidate. Nothing else changed.
  const withQualification = deriveRouteUniverse(universeInput(new Map([["groq:m", ["typescript"]]])));
  assert.deepEqual(withQualification.candidates.map((entry) => entry.candidateId), ["vercel-ai-sdk:groq:m"]);
  assert.deepEqual(withQualification.candidates[0]?.qualifiedTaskClasses, ["typescript"]);

  // A different task class on the same route earns nothing for this work.
  const wrongClass = deriveRouteUniverse(universeInput(new Map([["groq:m", ["node-test"]]])));
  assert.deepEqual(wrongClass.candidates.map((entry) => entry.candidateId), []);

  // The same task class on a sibling model earns nothing for this one.
  const wrongModel = deriveRouteUniverse(universeInput(new Map([["groq:other", ["typescript"]]])));
  assert.deepEqual(wrongModel.candidates.map((entry) => entry.candidateId), []);
});

/**
 * Adversarial proof for the Antigravity worker turn.
 *
 * A route that answers every time and produces nothing usable is the one failure
 * the transport layer cannot report, so the mode it runs in is pinned and
 * asserted rather than left to a default.
 */
test("the antigravity worker turn pins accept-edits and never plan mode", () => {
  const argv = antigravityCliArguments("do the work", "gpt-oss-120b-medium");
  const mode = argv[argv.indexOf("--mode") + 1];
  assert.equal(mode, "accept-edits");
  assert.notEqual(mode, "plan");
  assert.equal(argv.includes("plan"), false);
  // The rest of the turn stays bounded: one printed answer, structured output,
  // sandboxed, and an explicit model because the transport's default carries its
  // own quota.
  assert.equal(argv.includes("--print"), true);
  assert.deepEqual(argv.slice(argv.indexOf("--output-format"), argv.indexOf("--output-format") + 2), ["--output-format", "stream-json"]);
  assert.equal(argv.includes("--sandbox"), true);
  assert.equal(argv[argv.indexOf("--model") + 1], "gpt-oss-120b-medium");
  // Exactly one mode is named, so no later argument can override it.
  assert.equal(argv.filter((entry) => entry === "--mode").length, 1);
});

/**
 * Adversarial proof that the presented CLI surface and the dispatching one agree.
 *
 * Help is a hand-maintained table and the dispatcher is what actually parses, so
 * they are two statements of one surface and nothing forced them to match. They
 * did not. `probe qualify` was implemented, reachable, and the command's own
 * refusal message named it -- while help offered only availability and semantic,
 * so the live qualification path was undiscoverable from the CLI that carries it.
 * `profile build`, `export` and `import` were implemented and registered in the
 * graph and likewise absent.
 *
 * This does not turn help into a derived projection; that is a redesign. It makes
 * the second statement provably consistent with the first, which is the part that
 * was missing.
 */
test("every subcommand the dispatcher accepts is presented, and every presented one dispatches", async () => {
  const commandSource = await readFile(resolve(repositoryRoot, "src/commands/probe.ts"), "utf8");
  const profileSource = await readFile(resolve(repositoryRoot, "src/commands/profile.ts"), "utf8");
  const helpSource = await readFile(resolve(repositoryRoot, "src/commands/help.ts"), "utf8");

  /**
   * What the handler accepts. An explicit allowlist array is preferred where one
   * exists, because it is the handler's own complete statement; scraping the
   * equality chain is the fallback and cannot see a fallthrough default, which is
   * exactly how `profile status` reads as unaccepted when it is the default.
   */
  const accepted = (source: string): readonly string[] => {
    const allowlist = /const operations = \[([^\]]+)\] as const;/u.exec(source);
    if (allowlist !== null) {
      return Object.freeze([...new Set([...(allowlist[1] as string).matchAll(/"([a-z-]+)"/gu)].map((m) => m[1] as string))].sort());
    }
    return Object.freeze([...new Set([
      ...[...source.matchAll(/operation === "([a-z-]+)"/gu)].map((m) => m[1] as string),
      ...[...source.matchAll(/operation !== "([a-z-]+)"/gu)].map((m) => m[1] as string),
    ])].sort());
  };

  // What help presents is the alternation in its own synopsis lines.
  const presented = (command: string): readonly string[] => {
    const found = new Set<string>();
    for (const match of helpSource.matchAll(new RegExp(String.raw`usf ${command} (?:<([a-z|-]+)>|([a-z][a-z-]*))`, "gu"))) {
      if (match[1] !== undefined) for (const part of match[1].split("|")) found.add(part);
      else if (match[2] !== undefined) found.add(match[2]);
    }
    return Object.freeze([...found].sort());
  };

  for (const [command, source] of [["probe", commandSource], ["profile", profileSource]] as const) {
    const dispatches = accepted(source);
    const shown = presented(command);
    assert.ok(dispatches.length > 0, `${command} accepts at least one operation`);
    assert.deepEqual(
      dispatches.filter((operation) => !shown.includes(operation)), [],
      `${command}: implemented and reachable but absent from help`,
    );
    assert.deepEqual(
      shown.filter((operation) => !dispatches.includes(operation)), [],
      `${command}: presented in help but not accepted by the handler`,
    );
  }
});

/**
 * Adversarial proof for the external CLI argv Hermes constructs.
 *
 * A flag the binary rejects fails the whole route as a usage error, and the mode
 * a flag selects can make a route answer every time while producing nothing --
 * which is how one transport spent 606 619 output tokens across 20 successful
 * invocations for zero accepted results. Neither failure is visible in the
 * transport layer, so the argv is asserted here against the shape each installed
 * CLI documents, recorded at claude 2.1.251, codex-cli 0.152.0 and agy 1.1.26.
 */
test("every constructed provider argv names only flags and values the CLI documents", () => {
  const claude = claudeCliArguments("work", "claude-haiku-4-5-20251001");
  assert.deepEqual([...claude], ["-p", "work", "--output-format", "json", "--safe-mode", "--tools", "", "--strict-mcp-config", "--model", "claude-haiku-4-5-20251001"]);
  // json is one of exactly text, json and stream-json; --max-turns is not a flag
  // this CLI has, and reintroducing it would fail the route.
  assert.equal(claude.includes("--max-turns"), false);
  assert.equal(claude[claude.indexOf("--output-format") + 1], "json");
  // Omitting the model is permitted by the CLI and refused here: the transport's
  // default carries its own quota and is not the model the operator chose.
  assert.deepEqual([...claudeCliArguments("work", null)], ["-p", "work", "--output-format", "json", "--safe-mode", "--tools", "", "--strict-mcp-config"]);

  const agy = antigravityCliArguments("work", "gpt-oss-120b-medium");
  assert.equal(agy[agy.indexOf("--mode") + 1], "accept-edits");
  assert.equal(agy.includes("plan"), false);
  assert.equal(agy[agy.indexOf("--output-format") + 1], "stream-json");
  assert.equal(agy.filter((entry) => entry === "--mode").length, 1);

  const codex = codexModelSelection("gpt-5.3-codex-spark@medium");
  // The effort is always explicit: exec inherits the operator's config.toml
  // otherwise, which is how single worker units burned a million reasoning
  // tokens. A declared model@effort suffix selects it; anything else takes low.
  assert.equal(codex.effort, "medium");
  assert.equal(codex.model, "gpt-5.3-codex-spark");
  assert.equal(codexModelSelection(null).effort, "low");
  assert.equal(codexModelSelection("gpt-5.6-sol").effort, "low");
});
