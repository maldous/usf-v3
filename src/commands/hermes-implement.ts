import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { canonicalDigest } from "../core/canonical.ts";
import { exitCodes, UsfError } from "../core/errors.ts";
import { canonicalQuadLine } from "../graph/nquads.ts";
import { loadSemanticGraph, type SemanticGraph } from "../graph/index.ts";
import {
  loadConformanceEvidence, recordConformanceRun, runCapabilityConformance, typecheckCandidateModule,
} from "../providers/implementation-conformance.ts";
import { evaluateFacets, summariseFacets } from "../providers/facet-evaluation.ts";
import {
  deriveCapabilityImplementationNeeds, deriveConformancePrompt, deriveImplementationPrompt,
  deriveImplementationWorkUnits, importSpecifierFor, inspectRepositoryFile, maximumRepairRounds,
  maximumRewriteBytes, maximumSiblingBytes,
  readConformanceRule, readImplementationConvention, readImplementationConventions,
  validateConformanceOutput, validateImplementationOutput,
  type CapabilityImplementationNeed, type CapabilityRepairState, type FailingRequirement,
  type ImplementationWorkUnit,
} from "../providers/implementation-work.ts";
import {
  lookupSemanticResult, recordSemanticReuse, semanticCacheStatistics, storeSemanticResult,
  type SemanticWorkIdentity,
} from "../providers/semantic-cache.ts";
import type { CommandResult } from "./dispatcher.ts";

/**
 * Product implementation realization.
 *
 * The artefact lane realizes specification documents. This lane realizes the
 * product behaviour those documents specify: it derives cohesive implementation
 * work from the outstanding facet requirements, dispatches it across the
 * non-Claude provider universe, lands the result at graph-derived paths, and
 * then executes the behaviour to produce evidence the facet evaluator can read.
 * Nothing here writes satisfaction.
 */
const deliveryManifest = "graph/manifests/v3-delivery.json";
const maximumDispatch = 12;
const maximumConformanceRuns = 24;
// Measured, not assumed. Requiring the catalogue "reasoning" capability halved
// the universe to the models that spend their whole output budget thinking and
// return nothing (finishReason "length" after three minutes), while raising the
// budget to 16000 made that worse and tripped one provider's request ceiling.
// Writing a self-contained module is instruction-following, not reasoning, so
// the requirement is dropped and the budget is sized for the module itself.
const modelOutputTokens = 8_000;
const minimumContextTokens = 32_768;

interface ParsedArguments {
  readonly apply: boolean;
  readonly envFile: string | null;
  readonly dispatchLimit: number;
  readonly concurrency: number;
  readonly onlyCapability: string | null;
  readonly manifest: string;
}

function parse(args: readonly string[]): ParsedArguments {
  const values = new Map<string, string>();
  let apply = false;
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index]!;
    if (option === "--apply") { apply = true; continue; }
    if (!["--env-file", "--limit", "--concurrency", "--capability", "--manifest"].includes(option) || values.has(option)) {
      throw new UsfError("HERMES_IMPLEMENT_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT,
        "Implement accepts only --apply, --env-file, --limit, --concurrency, --capability and --manifest.", { option });
    }
    const value = args[++index];
    if (value === undefined || value.length === 0 || value.startsWith("--")) {
      throw new UsfError("HERMES_IMPLEMENT_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, `Missing value for ${option}.`);
    }
    values.set(option, value);
  }
  const limitText = values.get("--limit") ?? String(maximumDispatch);
  if (!/^[1-9][0-9]?$/u.test(limitText) || Number(limitText) > 64) {
    throw new UsfError("HERMES_IMPLEMENT_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, "--limit must be a positive integer of at most 64.");
  }
  const concurrencyText = values.get("--concurrency") ?? "6";
  if (!/^[1-9][0-9]?$/u.test(concurrencyText) || Number(concurrencyText) > 16) {
    throw new UsfError("HERMES_IMPLEMENT_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, "--concurrency must be a positive integer of at most 16.");
  }
  return Object.freeze({
    apply, envFile: values.get("--env-file") ?? null,
    dispatchLimit: Number(limitText), concurrency: Number(concurrencyText),
    onlyCapability: values.get("--capability") ?? null,
    // Which profile's capabilities form the frontier. USF's own delivery
    // authority is the default; a product profile selects its own manifest, and
    // the two never mix because a manifest declares exactly one convention.
    manifest: values.get("--manifest") ?? deliveryManifest,
  });
}

/**
 * Exact current bytes, never the bounded inspection read.
 *
 * A preimage digest must describe the whole file. Deriving it from the
 * truncated copy shown to a model made the transaction refuse
 * TRANSACT_STALE_PREIMAGE and discarded nine accepted results in one cycle.
 */
async function preimageDigestOf(repositoryRoot: string, path: string): Promise<string | null> {
  const bytes = await readFile(resolve(repositoryRoot, path), "utf8").catch(() => undefined);
  return bytes === undefined ? null : canonicalDigest(bytes);
}

async function presentPaths(
  // Each need resolves against the repository that owns it, because a composed
  // selection spans more than one and a path present in one is absent in the
  // other.
  rootOf: (repository: string | null) => string,
  needs: readonly CapabilityImplementationNeed[],
): Promise<ReadonlySet<string>> {
  const present = new Set<string>();
  await Promise.all(needs.flatMap((need) => [need.modulePath, need.conformancePath].map(async (path) => {
    const bytes = await readFile(resolve(rootOf(need.sourceRepository), path), "utf8").catch(() => undefined);
    if (bytes !== undefined) present.add(path);
  })));
  return present;
}

/**
 * A landed sibling is the best convention authority a model can be given: it
 * shows the exact shape this product already accepts, so nothing is invented.
 */
async function siblingModule(
  repositoryRoot: string,
  needs: readonly CapabilityImplementationNeed[],
  present: ReadonlySet<string>,
  exclude: string,
): Promise<Readonly<{ path: string; source: string }> | null> {
  for (const need of needs) {
    if (need.modulePath === exclude || !present.has(need.modulePath)) continue;
    const source = await inspectRepositoryFile(repositoryRoot, need.modulePath, maximumSiblingBytes);
    if (source !== null) return Object.freeze({ path: need.modulePath, source });
  }
  return null;
}

function identityFor(
  unit: ImplementationWorkUnit,
  prompt: string,
  inputDigests: readonly string[],
  policyDigest: string,
): SemanticWorkIdentity {
  return Object.freeze({
    requirement: unit.unit,
    inputDigests: Object.freeze([canonicalDigest(prompt), ...inputDigests]),
    dependencyResultDigests: Object.freeze([]),
    acceptanceRequirements: Object.freeze(unit.need.requirements.map((entry) => entry.facet)),
    requiredCapabilities: Object.freeze([]),
    outputContract: unit.stage === "implementation"
      ? "urn:usf:artefact-kind:capability-module"
      : "urn:usf:artefact-kind:capability-conformance-test",
    policyDigest,
    requiredProvider: null,
    requiredModel: null,
  });
}

interface DispatchEntry {
  readonly unit: ImplementationWorkUnit;
  readonly prompt: string;
  readonly identity: SemanticWorkIdentity;
  readonly outputTokens: number;
}

/**
 * An output budget that can actually hold the answer.
 *
 * A rewrite must emit at least the artefact it is rewriting. A fixed budget
 * sized for a fresh module truncates a large one mid-file, which the provider
 * reports as an empty result with finishReason "length" -- the failure mode
 * that blocked the four largest capabilities on every cycle.
 */
function outputBudgetFor(existingBytes: number): number {
  // A rewrite usually grows: it is correcting something the original did not
  // do. Budgeting for the original's size exactly is how a repair ends up
  // truncated a few lines from the end.
  const needed = Math.ceil(existingBytes / 2.5) + 3_000;
  return Math.min(32_000, Math.max(modelOutputTokens, needed));
}

interface Accepted {
  readonly path: string;
  readonly content: string;
  readonly preimageDigest: string | null;
  /** Which repository the path is relative to, so results can be grouped. */
  readonly repository: string | null;
}

/**
 * Resolve the on-disk root of a declared product repository.
 *
 * The graph declares a product repository by identity and layout; where it sits
 * on this machine is ignored operator state, exactly as credentials are. The
 * root is authenticated before it is returned, so realising into a product can
 * never become a way to write outside a declared, verified checkout.
 */
async function resolveProductRealisationRoot(
  repositoryRoot: string,
  graph: SemanticGraph,
  repository: string,
): Promise<string> {
  const { authenticateProductRepositoryRoot, readProductRepositories } =
    await import("../core/product-repository.ts");
  const declared = readProductRepositories(graph).find((entry) => entry.repository === repository);
  if (declared === undefined) {
    throw new UsfError("HERMES_IMPLEMENT_REPOSITORY_UNKNOWN", exitCodes.DOMAIN_FAILURE,
      "The implementation convention names a product repository the selected manifest does not declare.",
      { repository });
  }
  return authenticateProductRepositoryRoot(repositoryRoot, declared);
}

/**
 * What this invocation actually spent.
 *
 * Split by whether the result was kept, because tokens spent on a candidate
 * that did not compile are spent all the same. A total that counted only
 * accepted results would understate the cost of a bad cycle exactly when that
 * cost matters most. A cached result consumes nothing and is simply absent.
 */
export function summariseTokenUsage(
  outcomes: readonly Readonly<Record<string, unknown>>[],
): Readonly<Record<string, number>> {
  const total = { inputTokens: 0, outputTokens: 0, totalTokens: 0, acceptedTokens: 0, refusedTokens: 0, invocationsCounted: 0 };
  for (const outcome of outcomes) {
    const usage = outcome.usage as Readonly<Record<string, unknown>> | null | undefined;
    if (usage === null || usage === undefined) continue;
    const number = (key: string): number => {
      const value = usage[key];
      return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
    };
    const totalTokens = number("totalTokens");
    total.inputTokens += number("inputTokens");
    total.outputTokens += number("outputTokens");
    total.totalTokens += totalTokens;
    total.invocationsCounted += 1;
    if (outcome.outcome === "accepted") total.acceptedTokens += totalTokens;
    else total.refusedTokens += totalTokens;
  }
  return Object.freeze(total);
}

function localName(iri: string): string {
  return iri.split(":").slice(-2, -1)[0] ?? iri.split(":").pop() ?? iri;
}

export async function implementCommand(repositoryRoot: string, args: readonly string[]): Promise<CommandResult> {
  const parsed = parse(args);
  const graph: SemanticGraph = loadSemanticGraph(repositoryRoot, parsed.manifest);
  const conventions = readImplementationConventions(graph);
  // Compose freely: a selection may declare the foundation's convention, a
  // product's, or both. Each capability lands under the one that owns it.
  const convention = conventions[0]!;
  // Paths the convention derives are relative to the repository that owns the
  // realisation, which is USF itself unless the convention names a product
  // repository. Resolving it here keeps every downstream read, preimage and
  // write on the same root rather than silently mixing two repositories.
  const rootByRepository = new Map<string | null, string>([[null, repositoryRoot]]);
  for (const entry of conventions) {
    if (entry.productRepository === null || rootByRepository.has(entry.productRepository)) continue;
    rootByRepository.set(entry.productRepository,
      await resolveProductRealisationRoot(repositoryRoot, graph, entry.productRepository));
  }
  const rootOf = (repository: string | null): string => rootByRepository.get(repository) ?? repositoryRoot;
  // The root of the convention listed first, kept for the single-profile
  // projections that report one realisation root.
  const realisationRoot = rootOf(convention.productRepository);
  const conformanceRule = readConformanceRule(graph);
  const policyDigest = canonicalDigest(graph.graphDigests ?? {});
  const allNeeds = deriveCapabilityImplementationNeeds(graph, conventions);
  const needs = parsed.onlyCapability === null ? allNeeds
    : allNeeds.filter((need) => need.canonicalName === parsed.onlyCapability);
  if (needs.length === 0 && parsed.onlyCapability !== null) {
    throw new UsfError("HERMES_IMPLEMENT_CAPABILITY_UNKNOWN", exitCodes.INVALID_INPUT,
      "No capability with outstanding implementation requirements carries that canonical name.", { capability: parsed.onlyCapability });
  }

  // A record's paths are relative to the repository that produced it. This
  // profile's records resolve under its realisation root; anything else is USF's.
  const sourceRootFor = (repository: string | null): string => rootOf(repository);

  const present = await presentPaths(rootOf, needs);

  // Conformance execution is independent of dispatch: any capability whose
  // module and test both exist but whose behaviour has not been observed under
  // the current bytes is a check waiting to run.
  const evidenceBefore = await loadConformanceEvidence(repositoryRoot, sourceRootFor);
  // A module alone is enough to check: compiling it is the cheapest way to
  // learn whether a test written against it could ever run.
  const awaitingCheck = needs.filter((need) =>
    present.has(need.modulePath)
    && need.requirements.some((requirement) => {
      const entry = evidenceBefore.get(requirement.facet);
      return entry === undefined || entry.stale;
    }));

  const rounds = await readRepairRounds(repositoryRoot);
  const candidateFailures = await readCandidateFailures(repositoryRoot);
  const repairs = deriveRepairState(needs, evidenceBefore, rounds);
  // Capabilities whose module was last seen compiling against current bytes.
  const holding = new Set(needs
    .filter((need) => need.requirements.some((requirement) => {
      const entry = evidenceBefore.get(requirement.facet);
      return entry !== undefined && entry.executed && !entry.stale;
    }))
    .map((need) => need.capability));
  const units = deriveImplementationWorkUnits(needs, present, repairs);
  const ready = units.filter((unit) => unit.ready);
  const blocked = units.filter((unit) => !unit.ready);
  const exhausted = needs.filter((need) => (rounds[need.capability] ?? 0) > maximumRepairRounds);

  const plan = Object.freeze({
    schema: "urn:usf:implementation-realisation-plan:1" as const,
    version: 1 as const,
    evaluated: true as const,
    convention: convention.convention,
    conformanceRule: conformanceRule?.rule ?? null,
    capabilityCount: allNeeds.length,
    requirementCount: allNeeds.reduce((total, need) => total + need.requirements.length, 0),
    unitCount: units.length,
    readyFrontier: ready.length,
    blockedOnPredecessor: blocked.length,
    implementationUnitsReady: ready.filter((unit) => unit.stage === "implementation").length,
    conformanceUnitsReady: ready.filter((unit) => unit.stage === "conformance").length,
    modulesLanded: needs.filter((need) => present.has(need.modulePath)).length,
    conformanceTestsLanded: needs.filter((need) => present.has(need.conformancePath)).length,
    awaitingConformanceCheck: awaitingCheck.length,
    repairUnitsReady: ready.filter((unit) => unit.repairs.length > 0).length,
    repairExhausted: exhausted.length,
  });

  // Facet satisfaction is a property of the selected profile, not of the
  // artefact lane that used to compute it. A product supervisor does not run
  // that lane at all, so deriving it here is what lets a profile see its own
  // truth. Only executed behavioural outcomes are supplied, because every
  // product facet is evidenced by implementation conformance.
  //
  // It must be derived from the evidence that exists when it is reported. A
  // summary taken before this invocation's own conformance runs is a cycle
  // behind, which reported SATISFIED 0 for a capability whose four subtests had
  // just passed.
  const summariseCurrentFacets = async (): Promise<ReturnType<typeof summariseFacets>> =>
    summariseFacets(evaluateFacets(graph, Object.freeze({
      realizedArtefacts: new Map<string, string>(),
      runtimeComposed: false,
      validatorOutcomes: Object.freeze([] as readonly string[]),
      proofOutcomes: Object.freeze([] as readonly string[]),
      conformanceOutcomes: await loadConformanceEvidence(repositoryRoot, sourceRootFor),
    })));

  if (!parsed.apply) {
    return {
      output: Object.freeze({
        ...plan,
        facets: await summariseCurrentFacets(),
        frontier: Object.freeze(ready.slice(0, 24).map((unit) => Object.freeze({
          unit: unit.unit, stage: unit.stage, capability: unit.need.canonicalName,
          targetPath: unit.targetPath, requirements: unit.need.requirements.length,
          repairRound: unit.repairRound, repairs: unit.repairs.length,
        }))),
        cache: await semanticCacheStatistics(repositoryRoot),
      }),
      exitCode: exitCodes.SUCCESS,
    };
  }

  // ---- run outstanding behavioural checks first ------------------------------
  // Evidence is cheaper than tokens and it can retire work before it is
  // dispatched, so it always runs before anything is sent to a provider.
  const conformanceResults: Array<Readonly<Record<string, unknown>>> = [];
  for (const need of awaitingCheck.slice(0, maximumConformanceRuns)) {
    const run = await runCapabilityConformance(
      repositoryRoot, need, policyDigest, need.sourceRepository, rootOf(need.sourceRepository));
    const path = await recordConformanceRun(repositoryRoot, run);
    conformanceResults.push(Object.freeze({
      capability: need.canonicalName, evidencePath: path, executed: run.executed,
      refusal: run.refusal, typecheckClean: run.typecheck.clean,
      passed: run.outcomes.filter((outcome) => outcome.passed).length,
      failed: run.outcomes.filter((outcome) => outcome.executed && !outcome.passed).length,
      unobserved: run.outcomes.filter((outcome) => !outcome.executed).length,
    }));
  }

  // ---- dispatch the ready frontier -------------------------------------------
  const accepted: Accepted[] = [];
  const outcomes: Array<Readonly<Record<string, unknown>>> = [];
  let cacheHits = 0;
  let dispatched = 0;
  // Interleave the stages rather than taking the frontier in name order.
  //
  // Slicing an ordered frontier starves whichever stage sorts late. Observed:
  // 19 conformance units ahead of 5 implementation units meant a cycle spent
  // its whole budget on tests while ten capabilities still had no module at
  // all, and the module count sat still for cycles while results kept being
  // accepted. Round-robin keeps every stage moving: a capability with nothing
  // gets a module, a landed module gets the test that turns it into evidence,
  // and a failing one gets its repair.
  const lanes: readonly (readonly ImplementationWorkUnit[])[] = [
    ready.filter((unit) => unit.stage === "implementation" && unit.repairs.length === 0),
    ready.filter((unit) => unit.stage === "conformance" && unit.repairs.length === 0),
    ready.filter((unit) => unit.repairs.length > 0),
  ];
  const selected: ImplementationWorkUnit[] = [];
  for (let depth = 0; selected.length < parsed.dispatchLimit; depth += 1) {
    const before = selected.length;
    for (const lane of lanes) {
      const unit = lane[depth];
      if (unit !== undefined && selected.length < parsed.dispatchLimit) selected.push(unit);
    }
    if (selected.length === before) break;
  }
  const pending: DispatchEntry[] = [];

  for (const unit of selected) {
    // The artefact being rewritten is shown whole; the module a test binds to
    // is shown whole too, because a test cannot bind to a surface it cannot see.
    const unitRoot = rootOf(unit.need.sourceRepository);
    const existingTarget = await inspectRepositoryFile(unitRoot, unit.targetPath, maximumRewriteBytes);
    const moduleSource = unit.stage === "conformance"
      ? await inspectRepositoryFile(unitRoot, unit.need.modulePath, maximumRewriteBytes) : null;
    if (unit.stage === "conformance" && moduleSource === null) continue;
    const specifier = importSpecifierFor(unit.need);
    const priorFailure = candidateFailures[unit.need.capability];
    const carried: readonly FailingRequirement[] = unit.repairs.length > 0 ? unit.repairs
      : priorFailure === undefined ? Object.freeze([])
      : Object.freeze([Object.freeze({
          facetName: unit.need.canonicalName,
          detail: `a previous attempt at this module was discarded because it did not compile: ${priorFailure}`,
        })]);
    const prompt = unit.stage === "implementation"
      ? deriveImplementationPrompt(unit.need, convention, Object.freeze({
          existingTarget,
          moduleSource: null,
          siblingModule: await siblingModule(unitRoot, needs, present, unit.need.modulePath),
        }), carried)
      : deriveConformancePrompt(unit.need, moduleSource!, specifier, unit.repairs, existingTarget);
    // Existing source is part of identity: a changed module must not reuse a
    // test written against the surface it used to have.
    const inputDigests = [
      ...(existingTarget === null ? [] : [canonicalDigest(existingTarget)]),
      ...(moduleSource === null ? [] : [canonicalDigest(moduleSource)]),
      ...unit.need.requirements.map((requirement) => canonicalDigest(requirement.statement)),
      ...(carried.length === 0 ? [] : [canonicalDigest(carried)]),
    ];
    const outputTokens = outputBudgetFor(Math.max(existingTarget?.length ?? 0, moduleSource?.length ?? 0));
    const identity = identityFor(unit, prompt, inputDigests, policyDigest);
    const lookup = await lookupSemanticResult(repositoryRoot, identity);
    if (lookup.hit && lookup.entry !== null) {
      const checked = unit.stage === "implementation"
        ? validateImplementationOutput(lookup.entry.text)
        : validateConformanceOutput(lookup.entry.text, unit.need, specifier);
      // A cached result whose bytes are already at the target proves nothing:
      // re-landing them cannot change anything the last check did not already
      // observe. During repair this was worse than useless -- the failing test
      // was "regenerated" from cache as its own identical self for ten rounds,
      // each reported as reuse, while only the module ever actually changed.
      const landedDigest = await preimageDigestOf(unitRoot, unit.targetPath);
      const identicalToLanded = checked.accepted && landedDigest !== null
        && checked.contentDigest === landedDigest;
      if (checked.accepted && !identicalToLanded) {
        cacheHits += 1;
        await recordSemanticReuse(repositoryRoot, lookup.entry);
        accepted.push(Object.freeze({
          path: unit.targetPath, content: checked.content,
          repository: unit.need.sourceRepository,
          preimageDigest: await preimageDigestOf(unitRoot, unit.targetPath),
        }));
        outcomes.push(Object.freeze({ unit: unit.unit, stage: unit.stage, capability: unit.need.canonicalName, outcome: "reused" }));
        continue;
      }
    }
    pending.push(Object.freeze({ unit, prompt, identity, outputTokens }));
  }

  let evidenceDigest: string | null = null;

  let dispatchConcurrency: Record<string, unknown> | null = null;
  if (pending.length > 0 && parsed.envFile !== null) {
    const workGraph = "urn:usf:graph:implementation-realisation";
    const quads = pending.flatMap(({ unit, prompt, outputTokens }) => [
      { subject: unit.unit, predicate: "urn:usf:predicate:type", object: "urn:usf:type:SemanticWorkUnit", objectKind: "iri" as const, graph: workGraph, canonical: "" },
      { subject: unit.unit, predicate: "urn:usf:predicate:prompt", object: prompt, objectKind: "literal" as const, graph: workGraph, canonical: "" },
      { subject: unit.unit, predicate: "urn:usf:predicate:maximumOutputTokens", object: String(outputTokens), objectKind: "literal" as const, graph: workGraph, canonical: "" },
      { subject: unit.unit, predicate: "urn:usf:predicate:minimumContextTokens", object: String(minimumContextTokens), objectKind: "literal" as const, graph: workGraph, canonical: "" },
    ]).map((quad) => ({ ...quad, canonical: canonicalQuadLine(quad) }));
    const workPath = ".usf/work/implementation-realisation.nq";
    await mkdir(resolve(repositoryRoot, ".usf", "work"), { recursive: true, mode: 0o700 });
    await writeFile(resolve(repositoryRoot, workPath),
      `${quads.map((quad) => quad.canonical).sort().join("\n")}\n`, { mode: 0o600 });

    const { graphExecuteCommand } = await import("./graph-execute.ts");
    const executed = await graphExecuteCommand(repositoryRoot, [
      "--input", workPath, "--graph", workGraph, "--env-file", parsed.envFile,
      "--concurrency", String(Math.min(parsed.concurrency, pending.length)),
    ]).catch((error: unknown) => ({
      output: Object.freeze({ status: "refused", failure: error instanceof Error ? error.message.slice(0, 300) : "unknown" }),
      exitCode: exitCodes.EXTERNAL_UNAVAILABLE,
    }));
    const result = executed.output as Record<string, unknown>;
    evidenceDigest = typeof result.evidenceDigest === "string" ? result.evidenceDigest : null;
    dispatchConcurrency = (result.concurrency as Record<string, unknown> | undefined) ?? null;
    const records = Array.isArray(result.units) ? result.units as Record<string, unknown>[] : [];
    const byUnit = new Map(records.map((record) => [record.unit as string, record] as const));
    // Admission verdicts fold back into route history after the loop: the
    // transport layer knows a route answered, only this layer knows whether the
    // answer was worth keeping, and ordering runs on what was kept.
    const admissions: Array<Readonly<{ candidateId: string; admitted: boolean }>> = [];
    const admissionOf = (record: Record<string, unknown>, admitted: boolean): void => {
      const candidateId = record.selectedCandidateId;
      if (typeof candidateId === "string" && candidateId.length > 0) admissions.push(Object.freeze({ candidateId, admitted }));
    };
    for (const { unit, identity } of pending) {
      const record = byUnit.get(unit.unit);
      if (record === undefined || record.status !== "ok" || typeof record.resultText !== "string") {
        outcomes.push(Object.freeze({
          unit: unit.unit, stage: unit.stage, capability: unit.need.canonicalName, outcome: "refused",
          reason: (record?.attempts as Array<{ reasonCode?: unknown }> | undefined)?.at(-1)?.reasonCode
            ?? (result.failure as string | undefined) ?? "NO_RESULT",
        }));
        continue;
      }
      dispatched += 1;
      const specifier = importSpecifierFor(unit.need);
      const checked = unit.stage === "implementation"
        ? validateImplementationOutput(record.resultText)
        : validateConformanceOutput(record.resultText, unit.need, specifier);
      if (!checked.accepted) {
        admissionOf(record, false);
        // Truncation must reach the repair prompt as truncation. The compiler
        // would otherwise report the damage hundreds of lines from its cause
        // and the next round would chase a defect the model never made.
        if (checked.code === "candidate-truncated") {
          candidateFailures[unit.need.capability] = (checked.detail ?? "the generation was truncated").slice(0, 1_200);
        }
        outcomes.push(Object.freeze({
          unit: unit.unit, stage: unit.stage, capability: unit.need.canonicalName, outcome: "output-refused",
          code: checked.code, detail: checked.detail, transport: record.transport ?? null, actualModel: record.actualModel ?? null,
          usage: record.usage ?? null,
        }));
        continue;
      }
      // A capability module is USF source and enters USF's own typecheck, so a
      // module that does not compile must never land. Landing one and repairing
      // it afterwards was defensible while these lived in a product directory;
      // it is not defensible when it turns the framework's own gate red.
      //
      // The compiler output is what makes the next attempt effective, so it is
      // kept even though the candidate is discarded.
      if (unit.stage === "implementation") {
        const candidate = await typecheckCandidateModule(repositoryRoot, checked.content);
        if (!candidate.clean) {
          admissionOf(record, false);
          candidateFailures[unit.need.capability] = (candidate.detail ?? "the module does not compile").slice(0, 1_200);
          outcomes.push(Object.freeze({
            unit: unit.unit, stage: unit.stage, capability: unit.need.canonicalName,
            outcome: "output-refused",
            code: holding.has(unit.need.capability) ? "candidate-regresses-module" : "candidate-does-not-compile",
            detail: (candidate.detail ?? "the module does not compile").slice(0, 300),
            transport: record.transport ?? null, actualModel: record.actualModel ?? null,
            usage: record.usage ?? null,
          }));
          continue;
        }
        // Cleared only when the joint state is healthy, not here: a module that
        // compiles alone says nothing about the pair, and clearing on this
        // signal erased the exact context the test's repair round needed --
        // the test then regenerated blind while the module regenerated small.
        if (!(unit.need.capability in rounds)) delete candidateFailures[unit.need.capability];
      }
      admissionOf(record, true);
      await storeSemanticResult(repositoryRoot, identity, checked.content, evidenceDigest);
      accepted.push(Object.freeze({
        path: unit.targetPath, content: checked.content,
        repository: unit.need.sourceRepository,
        preimageDigest: await preimageDigestOf(rootOf(unit.need.sourceRepository), unit.targetPath),
      }));
      outcomes.push(Object.freeze({
        unit: unit.unit, stage: unit.stage, capability: unit.need.canonicalName, outcome: "accepted",
        transport: record.transport ?? null, actualModel: record.actualModel ?? null, usage: record.usage ?? null,
      }));
    }

    if (admissions.length > 0) {
      const { readRouteDeferrals, writeRouteDeferrals, applyOutputAdmissions } =
        await import("../providers/route-deferral.ts");
      await writeRouteDeferrals(repositoryRoot,
        applyOutputAdmissions(await readRouteDeferrals(repositoryRoot), admissions, Date.now()));
    }
  }

  // A repair attempt is counted whether or not it produced a result, so a
  // capability that no provider can complete still reaches its bound.
  const advanced = { ...rounds };
  // A capability whose behaviour now holds starts its next repair, if it ever
  // needs one, from the beginning rather than from a history it has outgrown.
  for (const need of needs) {
    if (!repairs.has(need.capability)) delete advanced[need.capability];
  }
  for (const unit of selected) {
    if (unit.repairs.length === 0) continue;
    advanced[unit.need.capability] = unit.repairRound + 1;
  }
  if (Object.keys(advanced).length > 0 || Object.keys(rounds).length > 0) await writeRepairRounds(repositoryRoot, advanced);
  await writeCandidateFailures(repositoryRoot, candidateFailures);

  // Independent results are batched into one transaction. Conflict sets, not
  // unit count, decide the boundary, and every unit here owns a distinct path.
  let proposalPath: string | null = null;
  const proposals: Array<Readonly<{ repository: string | null; path: string; pathCount: number }>> = [];
  if (accepted.length > 0) {
    // One proposal per owning repository. A transaction targets exactly one
    // repository, so a composed selection that realised into two would be
    // unlandable as a single proposal; and a product realisation must never
    // overwrite the foundation's pending results, or vice versa.
    const byRepository = new Map<string | null, Map<string, Accepted>>();
    for (const entry of accepted) {
      const group = byRepository.get(entry.repository) ?? new Map<string, Accepted>();
      group.set(entry.path, entry);
      byRepository.set(entry.repository, group);
    }
    const directory = resolve(repositoryRoot, ".usf", "proposals");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    for (const [repository, byPath] of [...byRepository.entries()]
      .sort(([left], [right]) => (left ?? "").localeCompare(right ?? ""))) {
      const proposal = Object.freeze({
        schema: "urn:usf:semantic-transaction-proposal:1" as const,
        intent: `Land ${byPath.size} independent implementation results derived from outstanding facet requirements of ${repository ?? "the foundation"}.`,
        declaredAffectedPaths: Object.freeze([...byPath.keys()].sort()),
        operations: Object.freeze([...byPath.values()]
          .sort((left, right) => left.path.localeCompare(right.path))
          .map((entry) => Object.freeze({
            kind: "write-file" as const, path: entry.path, content: entry.content, preimageDigest: entry.preimageDigest,
          }))),
      });
      const path = repository === null
        ? ".usf/proposals/implementation-realisation.json"
        : `.usf/proposals/implementation-realisation-${localName(repository)}.json`;
      await writeFile(resolve(repositoryRoot, path), `${JSON.stringify(proposal, null, 2)}\n`, { mode: 0o600 });
      proposals.push(Object.freeze({ repository, path, pathCount: byPath.size }));
    }
    // Preserved for readers that expect a single path; the full set is below.
    proposalPath = proposals[0]?.path ?? null;
  }

  return {
    output: Object.freeze({
      ...plan,
      conformanceRuns: Object.freeze(conformanceResults),
      repairExhaustedCapabilities: Object.freeze(exhausted.map((need) => need.canonicalName)),
      // Derived after this invocation's conformance runs, so a check that just
      // passed is visible in the same cycle that produced it.
      facets: await summariseCurrentFacets(),
      tokenUsage: summariseTokenUsage(outcomes),
      // GOAL 14.3 evidence: observed, target and utilisation for this dispatch.
      dispatchConcurrency,
      targetRepository: convention.productRepository,
      realisationRoot: convention.productRepository === null ? "." : realisationRoot,
      dispatchedUnits: pending.length,
      modelInvocations: dispatched,
      cacheHits,
      acceptedResults: accepted.length,
      proposalPath,
      proposals: Object.freeze(proposals),
      executionEvidenceDigest: evidenceDigest,
      outcomes: Object.freeze(outcomes),
      cache: await semanticCacheStatistics(repositoryRoot),
      nonClaims: Object.freeze([
        "An accepted result is model output that satisfied a structural admission check. It is not evidence that any requirement is met.",
        "Only an executed conformance outcome can evidence an implementation-conformance requirement, and the facet evaluator alone derives the verdict.",
      ]),
    }),
    exitCode: exitCodes.SUCCESS,
  };
}

const repairRoundsPath = ".usf/hermes/repair-rounds.json";

async function readRepairRounds(repositoryRoot: string): Promise<Record<string, number>> {
  const bytes = await readFile(resolve(repositoryRoot, repairRoundsPath), "utf8").catch(() => undefined);
  if (bytes === undefined) return {};
  try {
    const parsed = JSON.parse(bytes) as { rounds?: Record<string, unknown> };
    const rounds: Record<string, number> = {};
    for (const [capability, value] of Object.entries(parsed.rounds ?? {})) {
      if (typeof value === "number" && Number.isInteger(value) && value >= 0) rounds[capability] = value;
    }
    return rounds;
  } catch { return {}; }
}

async function writeRepairRounds(repositoryRoot: string, rounds: Record<string, number>): Promise<void> {
  await mkdir(resolve(repositoryRoot, ".usf", "hermes"), { recursive: true, mode: 0o700 });
  await writeFile(resolve(repositoryRoot, repairRoundsPath),
    `${JSON.stringify({ schema: "urn:usf:hermes-repair-rounds:1", version: 1, rounds }, null, 1)}\n`, { mode: 0o600 });
}

/**
 * Which capabilities have executed behavioural failures, and which repair round
 * each is on. A capability with no failing outcome is reset to zero, so a
 * capability that was repaired successfully does not carry its history forward.
 */
function deriveRepairState(
  needs: readonly CapabilityImplementationNeed[],
  evidence: Awaited<ReturnType<typeof loadConformanceEvidence>>,
  rounds: Record<string, number>,
): ReadonlyMap<string, CapabilityRepairState> {
  const state = new Map<string, CapabilityRepairState>();
  for (const need of needs) {
    const failing: FailingRequirement[] = [];
    for (const requirement of need.requirements) {
      const entry = evidence.get(requirement.facet);
      if (entry === undefined || entry.stale) continue;
      // Both a check that ran and failed and a check that could not run at all
      // are conditions repair exists to clear. Code that does not compile is
      // not evidence of anything, and leaving it produces a silent stall.
      if ((entry.executed && !entry.passed) || entry.blocked) {
        failing.push(Object.freeze({ facetName: requirement.canonicalName, detail: entry.detail }));
      }
    }
    if (failing.length === 0) continue;
    // A compiler that names only the conformance file has identified the wrong
    // artefact for us; regenerating a module that compiles would waste a round.
    const details = failing.map((entry) => entry.detail ?? "").join("\n");
    const namesTest = details.includes(need.conformancePath);
    const namesModule = details.includes(need.modulePath);
    state.set(need.capability, Object.freeze({
      failing: Object.freeze(failing),
      round: Math.max(1, (rounds[need.capability] ?? 0) || 1),
      ...(namesTest && !namesModule ? { preferredStage: "conformance" as const } : {}),
    }));
  }
  return state;
}

const candidateFailurePath = ".usf/hermes/candidate-failures.json";

/** Compiler output from candidates that were discarded rather than landed. */
async function readCandidateFailures(repositoryRoot: string): Promise<Record<string, string>> {
  const bytes = await readFile(resolve(repositoryRoot, candidateFailurePath), "utf8").catch(() => undefined);
  if (bytes === undefined) return {};
  try {
    const parsed = JSON.parse(bytes) as { failures?: Record<string, unknown> };
    const failures: Record<string, string> = {};
    for (const [capability, detail] of Object.entries(parsed.failures ?? {})) {
      if (typeof detail === "string") failures[capability] = detail;
    }
    return failures;
  } catch { return {}; }
}

async function writeCandidateFailures(repositoryRoot: string, failures: Record<string, string>): Promise<void> {
  await mkdir(resolve(repositoryRoot, ".usf", "hermes"), { recursive: true, mode: 0o700 });
  await writeFile(resolve(repositoryRoot, candidateFailurePath),
    `${JSON.stringify({ schema: "urn:usf:hermes-candidate-failures:1", version: 1, failures }, null, 1)}\n`,
    { mode: 0o600 });
}
