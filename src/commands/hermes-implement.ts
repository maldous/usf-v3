import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { canonicalDigest } from "../core/canonical.ts";
import { exitCodes, UsfError } from "../core/errors.ts";
import { canonicalQuadLine } from "../graph/nquads.ts";
import { loadSemanticGraph, type SemanticGraph } from "../graph/index.ts";
import {
  loadConformanceEvidence, recordConformanceRun, runCapabilityConformance, typecheckCandidateModule,
} from "../providers/implementation-conformance.ts";
import {
  deriveCapabilityImplementationNeeds, deriveConformancePrompt, deriveImplementationPrompt,
  deriveImplementationWorkUnits, importSpecifierFor, inspectRepositoryFile, maximumRepairRounds,
  maximumRewriteBytes, maximumSiblingBytes,
  readConformanceRule, readImplementationConvention,
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
}

function parse(args: readonly string[]): ParsedArguments {
  const values = new Map<string, string>();
  let apply = false;
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index]!;
    if (option === "--apply") { apply = true; continue; }
    if (!["--env-file", "--limit", "--concurrency", "--capability"].includes(option) || values.has(option)) {
      throw new UsfError("HERMES_IMPLEMENT_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT,
        "Implement accepts only --apply, --env-file, --limit, --concurrency and --capability.", { option });
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
  repositoryRoot: string,
  needs: readonly CapabilityImplementationNeed[],
): Promise<ReadonlySet<string>> {
  const present = new Set<string>();
  await Promise.all(needs.flatMap((need) => [need.modulePath, need.conformancePath].map(async (path) => {
    const bytes = await readFile(resolve(repositoryRoot, path), "utf8").catch(() => undefined);
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
  const needed = Math.ceil(existingBytes / 3) + 2_000;
  return Math.min(32_000, Math.max(modelOutputTokens, needed));
}

interface Accepted {
  readonly path: string;
  readonly content: string;
  readonly preimageDigest: string | null;
}

export async function implementCommand(repositoryRoot: string, args: readonly string[]): Promise<CommandResult> {
  const parsed = parse(args);
  const graph: SemanticGraph = loadSemanticGraph(repositoryRoot, deliveryManifest);
  const convention = readImplementationConvention(graph);
  const conformanceRule = readConformanceRule(graph);
  const policyDigest = canonicalDigest(graph.graphDigests ?? {});
  const allNeeds = deriveCapabilityImplementationNeeds(graph, convention);
  const needs = parsed.onlyCapability === null ? allNeeds
    : allNeeds.filter((need) => need.canonicalName === parsed.onlyCapability);
  if (needs.length === 0 && parsed.onlyCapability !== null) {
    throw new UsfError("HERMES_IMPLEMENT_CAPABILITY_UNKNOWN", exitCodes.INVALID_INPUT,
      "No capability with outstanding implementation requirements carries that canonical name.", { capability: parsed.onlyCapability });
  }

  const present = await presentPaths(repositoryRoot, needs);

  // Conformance execution is independent of dispatch: any capability whose
  // module and test both exist but whose behaviour has not been observed under
  // the current bytes is a check waiting to run.
  const evidenceBefore = await loadConformanceEvidence(repositoryRoot);
  // A module alone is enough to check: compiling it is the cheapest way to
  // learn whether a test written against it could ever run.
  const awaitingCheck = needs.filter((need) =>
    present.has(need.modulePath)
    && need.requirements.some((requirement) => {
      const entry = evidenceBefore.get(requirement.facet);
      return entry === undefined || entry.stale;
    }));

  const rounds = await readRepairRounds(repositoryRoot);
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

  if (!parsed.apply) {
    return {
      output: Object.freeze({
        ...plan,
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
    const run = await runCapabilityConformance(repositoryRoot, need, policyDigest);
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
  const selected = ready.slice(0, parsed.dispatchLimit);
  const pending: DispatchEntry[] = [];

  for (const unit of selected) {
    // The artefact being rewritten is shown whole; the module a test binds to
    // is shown whole too, because a test cannot bind to a surface it cannot see.
    const existingTarget = await inspectRepositoryFile(repositoryRoot, unit.targetPath, maximumRewriteBytes);
    const moduleSource = unit.stage === "conformance"
      ? await inspectRepositoryFile(repositoryRoot, unit.need.modulePath, maximumRewriteBytes) : null;
    if (unit.stage === "conformance" && moduleSource === null) continue;
    const specifier = importSpecifierFor(unit.need);
    const prompt = unit.stage === "implementation"
      ? deriveImplementationPrompt(unit.need, convention, Object.freeze({
          existingTarget,
          moduleSource: null,
          siblingModule: await siblingModule(repositoryRoot, needs, present, unit.need.modulePath),
        }), unit.repairs)
      : deriveConformancePrompt(unit.need, moduleSource!, specifier, unit.repairs, existingTarget);
    // Existing source is part of identity: a changed module must not reuse a
    // test written against the surface it used to have.
    const inputDigests = [
      ...(existingTarget === null ? [] : [canonicalDigest(existingTarget)]),
      ...(moduleSource === null ? [] : [canonicalDigest(moduleSource)]),
      ...unit.need.requirements.map((requirement) => canonicalDigest(requirement.statement)),
      ...(unit.repairs.length === 0 ? [] : [canonicalDigest(unit.repairs)]),
    ];
    const outputTokens = outputBudgetFor(Math.max(existingTarget?.length ?? 0, moduleSource?.length ?? 0));
    const identity = identityFor(unit, prompt, inputDigests, policyDigest);
    const lookup = await lookupSemanticResult(repositoryRoot, identity);
    if (lookup.hit && lookup.entry !== null) {
      const checked = unit.stage === "implementation"
        ? validateImplementationOutput(lookup.entry.text)
        : validateConformanceOutput(lookup.entry.text, unit.need, specifier);
      if (checked.accepted) {
        cacheHits += 1;
        await recordSemanticReuse(repositoryRoot, lookup.entry);
        accepted.push(Object.freeze({
          path: unit.targetPath, content: checked.content,
          preimageDigest: await preimageDigestOf(repositoryRoot, unit.targetPath),
        }));
        outcomes.push(Object.freeze({ unit: unit.unit, stage: unit.stage, capability: unit.need.canonicalName, outcome: "reused" }));
        continue;
      }
    }
    pending.push(Object.freeze({ unit, prompt, identity, outputTokens }));
  }

  let evidenceDigest: string | null = null;
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
    const records = Array.isArray(result.units) ? result.units as Record<string, unknown>[] : [];
    const byUnit = new Map(records.map((record) => [record.unit as string, record] as const));
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
        outcomes.push(Object.freeze({
          unit: unit.unit, stage: unit.stage, capability: unit.need.canonicalName, outcome: "output-refused",
          code: checked.code, detail: checked.detail, transport: record.transport ?? null, actualModel: record.actualModel ?? null,
        }));
        continue;
      }
      // Never regress a module that holds up. A repair rewrites the whole file
      // to correct one requirement, and a rewrite that no longer compiles takes
      // every requirement of that capability down with it. Where the current
      // module was last observed compiling, the replacement must compile too.
      if (unit.stage === "implementation" && holding.has(unit.need.capability)) {
        const candidate = await typecheckCandidateModule(repositoryRoot, checked.content);
        if (!candidate.clean) {
          outcomes.push(Object.freeze({
            unit: unit.unit, stage: unit.stage, capability: unit.need.canonicalName,
            outcome: "output-refused", code: "candidate-regresses-module",
            detail: (candidate.detail ?? "the replacement does not compile").slice(0, 300),
            transport: record.transport ?? null, actualModel: record.actualModel ?? null,
          }));
          continue;
        }
      }
      await storeSemanticResult(repositoryRoot, identity, checked.content, evidenceDigest);
      accepted.push(Object.freeze({
        path: unit.targetPath, content: checked.content,
        preimageDigest: await preimageDigestOf(repositoryRoot, unit.targetPath),
      }));
      outcomes.push(Object.freeze({
        unit: unit.unit, stage: unit.stage, capability: unit.need.canonicalName, outcome: "accepted",
        transport: record.transport ?? null, actualModel: record.actualModel ?? null, usage: record.usage ?? null,
      }));
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

  // Independent results are batched into one transaction. Conflict sets, not
  // unit count, decide the boundary, and every unit here owns a distinct path.
  let proposalPath: string | null = null;
  if (accepted.length > 0) {
    const byPath = new Map(accepted.map((entry) => [entry.path, entry] as const));
    const proposal = Object.freeze({
      schema: "urn:usf:semantic-transaction-proposal:1" as const,
      intent: `Land ${byPath.size} independent ANQR implementation results derived from outstanding facet requirements.`,
      declaredAffectedPaths: Object.freeze([...byPath.keys()].sort()),
      operations: Object.freeze([...byPath.values()]
        .sort((left, right) => left.path.localeCompare(right.path))
        .map((entry) => Object.freeze({
          kind: "write-file" as const, path: entry.path, content: entry.content, preimageDigest: entry.preimageDigest,
        }))),
    });
    const directory = resolve(repositoryRoot, ".usf", "proposals");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    proposalPath = ".usf/proposals/implementation-realisation.json";
    await writeFile(resolve(repositoryRoot, proposalPath), `${JSON.stringify(proposal, null, 2)}\n`, { mode: 0o600 });
  }

  return {
    output: Object.freeze({
      ...plan,
      conformanceRuns: Object.freeze(conformanceResults),
      repairExhaustedCapabilities: Object.freeze(exhausted.map((need) => need.canonicalName)),
      dispatchedUnits: pending.length,
      modelInvocations: dispatched,
      cacheHits,
      acceptedResults: accepted.length,
      proposalPath,
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
