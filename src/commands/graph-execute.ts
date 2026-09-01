import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { canonicalDigest } from "../core/canonical.ts";
import { exitCodes, UsfError, type ExitCode } from "../core/errors.ts";
import { canonicalQuadDigest, canonicalQuadLine, parseStrictNQuads, type Quad } from "../graph/nquads.ts";
import { readDependencyGraph } from "../graph/work-dependency.ts";
import { invokeAntigravityCli, invokeClaudeCli, invokeCodexCli } from "../providers/cli-transports.ts";
import { CredentialEnvError, loadCredentialEnvFile } from "../providers/config.ts";
import { parseExecutionEconomicAuthorizations, type EffectiveCostPolicy } from "../providers/execution-economics.ts";
import { verifyEconomicsProjection } from "../providers/economics-projection.ts";
import { loadSemanticGraph } from "../graph/index.ts";
import {
  deriveRouteUniverse, diversifyCandidates, type ExecutionCandidate,
} from "../providers/route-universe.ts";
import { readAuthoritySnapshot, snapshotDifference, type AuthoritySnapshot } from "../providers/authority-snapshot.ts";
import { observeTransportCapability } from "../providers/transports.ts";
import type { CommandResult } from "./dispatcher.ts";
import { languageModelFor, parseEffectiveCostPolicy } from "./execute.ts";
import { observeInstalledAdapter, readLocalCatalogue } from "./models.ts";
import { observeAvailableRoutes } from "../providers/evidence-index.ts";
import { readProviderBindings, type ProviderBindings } from "../providers/provider-bindings.ts";
import { readProviderExecutionPolicy, type ProviderExecutionPolicy } from "../providers/provider-policy.ts";
import { readTrackedJson } from "./probe.ts";
import {
  applyRouteOutcomes, deferredCandidateIds, readRouteDeferrals, writeRouteDeferrals,
  type ObservedRouteOutcome,
} from "../providers/route-deferral.ts";

const typePredicate = "urn:usf:predicate:type";
const workUnitType = "urn:usf:type:SemanticWorkUnit";
const promptPredicate = "urn:usf:predicate:prompt";
const capabilityPredicate = "urn:usf:predicate:requiredCapability";
const outputTokensPredicate = "urn:usf:predicate:maximumOutputTokens";
const contextTokensPredicate = "urn:usf:predicate:minimumContextTokens";
const maximumInputBytes = 4 * 1024 * 1024;
const maximumQuads = 20_000;
const maximumWorkUnits = 64;
const defaultConcurrency = 4;
const hardMaximumConcurrency = 16;
const invocationTimeoutMs = 240_000;
// The candidate universe is deep and one refusal is an availability fact, not a
// terminal state, so a unit walks further down its diversified order before it
// gives up. The bound keeps a single unit from consuming a whole cycle.
const maximumCandidateAttempts = 8;

function invalid(message: string): never {
  throw new UsfError("GRAPH_EXECUTE_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, message);
}

interface ParsedArguments {
  readonly input: string;
  readonly graph: string;
  readonly envFile: string;
  readonly concurrency: number;
  readonly outputPath: string | null;
  /** Restrict execution to these work units; the scheduler supplies them. */
  readonly only: readonly string[] | null;
  /**
   * Units the caller has already proven terminally successful, possibly in
   * another work graph. They are treated as declared and satisfied for
   * dependency validation only; nothing about them is assumed otherwise.
   */
  readonly satisfiedDependencies: readonly string[];
}

function parse(args: readonly string[]): ParsedArguments {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index]!;
    if (!["--input", "--graph", "--env-file", "--concurrency", "--output", "--only", "--satisfied-dependency"].includes(option) || values.has(option)) {
      invalid(`Graph execute options must be unique and explicit: ${option}`);
    }
    const value = args[++index];
    if (value === undefined || value.length === 0 || value.startsWith("--")) invalid(`Missing value for ${option}.`);
    values.set(option, value);
  }
  const input = values.get("--input");
  const graph = values.get("--graph");
  const envFile = values.get("--env-file");
  if (input === undefined || graph === undefined || envFile === undefined) {
    invalid("Graph execute requires --input, --graph and --env-file.");
  }
  const concurrencyText = values.get("--concurrency") ?? String(defaultConcurrency);
  if (!/^[1-9][0-9]?$/u.test(concurrencyText)) invalid("--concurrency must be a positive integer.");
  const concurrency = Number(concurrencyText);
  if (concurrency > hardMaximumConcurrency) invalid("--concurrency exceeds the bounded maximum.");
  const onlyText = values.get("--only");
  const satisfiedText = values.get("--satisfied-dependency");
  return Object.freeze({
    input, graph, envFile, concurrency,
    outputPath: values.get("--output") ?? null,
    only: onlyText === undefined ? null : Object.freeze([...new Set(onlyText.split(","))].sort()),
    satisfiedDependencies: satisfiedText === undefined
      ? Object.freeze([])
      : Object.freeze([...new Set(satisfiedText.split(","))].sort()),
  });
}

interface SemanticWorkUnit {
  readonly iri: string;
  readonly prompt: string;
  readonly requiredCapabilities: readonly string[];
  readonly maximumOutputTokens: number;
  readonly minimumContextTokens: number | null;
  /** Digest of exactly the source quads that assert this unit. */
  readonly sourceAssertionDigest: string;
}

function literalsFor(quads: readonly Quad[], subject: string, predicate: string): readonly string[] {
  return Object.freeze(quads
    .filter((quad) => quad.subject === subject && quad.predicate === predicate && quad.objectKind === "literal")
    .map((quad) => quad.object));
}

function extractWorkUnits(quads: readonly Quad[]): readonly SemanticWorkUnit[] {
  const subjects = Object.freeze([...new Set(quads
    .filter((quad) => quad.predicate === typePredicate && quad.objectKind === "iri" && quad.object === workUnitType)
    .map((quad) => quad.subject))].sort());
  if (subjects.length === 0) {
    throw new UsfError("GRAPH_EXECUTE_NO_WORK_UNITS", exitCodes.INVALID_INPUT,
      "The supplied graph asserts no urn:usf:type:SemanticWorkUnit subject.");
  }
  if (subjects.length > maximumWorkUnits) {
    throw new UsfError("GRAPH_EXECUTE_TOO_MANY_WORK_UNITS", exitCodes.INVALID_INPUT,
      "The supplied graph exceeds the bounded work-unit count.", { maximumWorkUnits });
  }
  return Object.freeze(subjects.map((iri) => {
    const prompts = literalsFor(quads, iri, promptPredicate);
    if (prompts.length !== 1) {
      throw new UsfError("GRAPH_EXECUTE_WORK_UNIT_INVALID", exitCodes.INVALID_INPUT,
        "Each semantic work unit must assert exactly one prompt literal.", { workUnit: iri });
    }
    const outputTokensText = literalsFor(quads, iri, outputTokensPredicate);
    if (outputTokensText.length > 1) {
      throw new UsfError("GRAPH_EXECUTE_WORK_UNIT_INVALID", exitCodes.INVALID_INPUT,
        "A semantic work unit may assert at most one maximumOutputTokens literal.", { workUnit: iri });
    }
    const contextText = literalsFor(quads, iri, contextTokensPredicate);
    const numeric = (text: string | undefined, fallback: number | null): number | null => {
      if (text === undefined) return fallback;
      if (!/^[1-9][0-9]{0,9}$/u.test(text)) {
        throw new UsfError("GRAPH_EXECUTE_WORK_UNIT_INVALID", exitCodes.INVALID_INPUT,
          "A token bound must be a positive integer literal.", { workUnit: iri });
      }
      return Number(text);
    };
    const ownQuads = quads.filter((quad) => quad.subject === iri);
    return Object.freeze({
      iri,
      prompt: prompts[0]!,
      requiredCapabilities: Object.freeze([...new Set(literalsFor(quads, iri, capabilityPredicate))].sort()),
      maximumOutputTokens: numeric(outputTokensText[0], 1024) ?? 1024,
      minimumContextTokens: numeric(contextText[0], null),
      sourceAssertionDigest: canonicalQuadDigest(ownQuads),
    });
  }));
}

interface UnitAttempt {
  readonly candidateId: string;
  readonly transport: string;
  readonly provider: string;
  readonly model: string | null;
  readonly startedAt: string;
  readonly latencyMs: number;
  readonly outcome: "ok" | "refused";
  readonly reasonCode: string;
  readonly statusCode: number | null;
  readonly retryAfter: string | null;
  readonly costIncurred: boolean;
}

interface UnitOutcome {
  readonly unit: SemanticWorkUnit;
  readonly candidatesConsidered: number;
  readonly attempts: readonly UnitAttempt[];
  readonly status: "ok" | "refused";
  readonly selected: ExecutionCandidate | null;
  readonly actualModel: string | null;
  readonly invocationIdentity: string | null;
  readonly text: string | null;
  readonly usage: Readonly<{ inputTokens: number | null; outputTokens: number | null; totalTokens: number | null }> | null;
  readonly transportReportedCostUsd: number | null;
  readonly startedAtMs: number;
  readonly endedAtMs: number;
}

export async function graphExecuteCommand(repositoryRoot: string, args: readonly string[]): Promise<CommandResult> {
  const parsed = parse(args);
  const observedAt = new Date().toISOString();

  // 1. Accept and canonicalize the semantic graph.
  const inputPath = resolve(repositoryRoot, parsed.input);
  const source = await readFile(inputPath, "utf8").catch(() => undefined);
  if (source === undefined) {
    throw new UsfError("GRAPH_EXECUTE_INPUT_UNREADABLE", exitCodes.CONTAINMENT_REFUSAL, "The work graph could not be read.");
  }
  if (Buffer.byteLength(source, "utf8") > maximumInputBytes) {
    throw new UsfError("GRAPH_EXECUTE_INPUT_TOO_LARGE", exitCodes.CONTAINMENT_REFUSAL, "The work graph exceeds the bounded input size.");
  }
  let quads: Quad[];
  try {
    quads = parseStrictNQuads(source, parsed.graph, maximumQuads);
  } catch (error) {
    throw new UsfError("GRAPH_EXECUTE_INPUT_INVALID", exitCodes.INVALID_INPUT,
      "The work graph is not valid blank-node-free N-Quads in the named graph.",
      { reasonCode: error instanceof Error ? error.message : "NQUADS_INVALID" });
  }
  const sourceGraphDigest = canonicalQuadDigest(quads);
  const allUnits = extractWorkUnits(quads);

  // A work graph must be a cycle-safe DAG over declared units before anything
  // is scheduled. This is validated on the whole graph, not on the subset the
  // scheduler selected, so a cycle cannot hide outside the current slice.
  const dependencyGraph = readDependencyGraph(
    quads,
    Object.freeze([...new Set([...allUnits.map((unit) => unit.iri), ...parsed.satisfiedDependencies])].sort()),
  );
  if (dependencyGraph.defects.length > 0) {
    throw new UsfError("GRAPH_EXECUTE_DEPENDENCY_INVALID", exitCodes.INVALID_INPUT,
      "The work graph's dependency edges are not a valid acyclic graph over declared work units.",
      { defects: dependencyGraph.defects.slice(0, 8) });
  }
  const units = parsed.only === null
    ? allUnits
    : allUnits.filter((unit) => parsed.only!.includes(unit.iri));
  if (units.length === 0) {
    throw new UsfError("GRAPH_EXECUTE_NO_SELECTED_UNITS", exitCodes.INVALID_INPUT,
      "No declared work unit matched the selection.");
  }

  // 2. Authority and candidate universe inputs.

  const economicsDocument = await readTrackedJson(repositoryRoot, "config/execution-economics.json");
  // The graph is the semantic source. The runtime consumes the derived
  // projection only after proving it still corresponds to graph authority.
  let economicsClosureDigest: string;
  let graphPolicy: EffectiveCostPolicy;
  let bindings: ProviderBindings;
  let executionPolicy: ProviderExecutionPolicy;
  try {
    const semanticGraph = loadSemanticGraph(repositoryRoot, "graph/manifests/v3-convention.json");
    bindings = readProviderBindings(semanticGraph);
    executionPolicy = readProviderExecutionPolicy(semanticGraph);
    const verified = verifyEconomicsProjection(economicsDocument, semanticGraph);
    economicsClosureDigest = verified.graphClosureDigest;
    graphPolicy = Object.freeze({ ...verified.projection.costPolicy });
  } catch (error) {
    throw new UsfError("GRAPH_EXECUTE_ECONOMICS_NOT_GRAPH_DERIVED", exitCodes.CURRENTNESS_FAILURE,
      "The runtime economics projection does not correspond to current graph authority.",
      { reasonCode: error instanceof Error ? error.message : "UNKNOWN" });
  }
  const authorizations = parseExecutionEconomicAuthorizations(economicsDocument);

  // The whole effective policy comes from graph authority; config/policy.json
  // remains only for the superseded probe lane.
  const policy = graphPolicy;
  const catalogue = await readLocalCatalogue(repositoryRoot);
  const adapterPackages = Object.freeze([...new Set(
    catalogue.snapshot.providers.map((provider) => provider.adapter.package)
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  )].sort());
  const installed: string[] = [];
  for (const adapterPackage of adapterPackages) {
    if (await observeInstalledAdapter(repositoryRoot, adapterPackage) !== undefined) installed.push(adapterPackage);
  }
  const environmentNamePattern = /^[A-Z_][A-Z0-9_]{0,127}$/u;
  // The catalogue projection is the authority for credential names; it already
  // supplies every name the configured routes named.
  const allowlist = Object.freeze([...new Set(
    catalogue.snapshot.providers.flatMap((provider) => provider.credentialNames ?? []),
  )].filter((name) => environmentNamePattern.test(name)).sort());
  let environment: Awaited<ReturnType<typeof loadCredentialEnvFile>>;
  try {
    environment = await loadCredentialEnvFile(resolve(repositoryRoot, parsed.envFile), allowlist);
  } catch (error) {
    throw new UsfError("GRAPH_EXECUTE_ENV_FILE_REFUSED", exitCodes.CONTAINMENT_REFUSAL,
      "The explicit credential file was refused.",
      error instanceof CredentialEnvError ? { credentialReasonCode: error.reasonCode } : undefined);
  }
  const suppliedCredentialNames = Object.freeze(allowlist.filter((name) => {
    const value = environment.getCredential(name);
    return typeof value === "string" && value.length > 0;
  }).sort());
  const localAgentCapabilities = Object.freeze(await Promise.all(
    (["antigravity-cli", "claude-cli", "codex-cli"] as const).map((transport) => observeTransportCapability(transport, {
      repositoryRoot,
      homeDirectory: homedir(),
      observedAt,
      suppliedCredentialNames,
      requiredCredentialName: null,
      adapterInstalled: false,
    })),
  ));
  const observedRoutes = (await observeAvailableRoutes(repositoryRoot)).routeIds;

  /**
   * Re-read exactly the inputs a route selection depends on. The catalogue is
   * fingerprinted by size and modification instant rather than re-hashed, so
   * the bracket stays cheap enough to run before every dispatch.
   */
  const cataloguePaths = Object.freeze([".usf/catalog/models-dev.raw.json", ".usf/catalog/models-dev.normalized.json"]);
  const catalogueFingerprint = async (): Promise<string> => {
    const stats = await Promise.all(cataloguePaths.map(async (path) => {
      const metadata = await stat(resolve(repositoryRoot, path)).catch(() => undefined);
      return Object.freeze({ path, size: metadata?.size ?? null, modifiedMs: metadata?.mtimeMs ?? null });
    }));
    return canonicalDigest(stats);
  };
  const snapshotNow = async (): Promise<AuthoritySnapshot> => {
    const currentEconomics = await readTrackedJson(repositoryRoot, "config/execution-economics.json");
    const currentAdapters: string[] = [];
    for (const adapterPackage of adapterPackages) {
      if (await observeInstalledAdapter(repositoryRoot, adapterPackage) !== undefined) currentAdapters.push(adapterPackage);
    }
    const currentCapabilities = await Promise.all(
      (["antigravity-cli", "claude-cli", "codex-cli"] as const).map((transport) => observeTransportCapability(transport, {
        repositoryRoot, homeDirectory: homedir(), observedAt,
        suppliedCredentialNames, requiredCredentialName: null, adapterInstalled: false,
      })),
    );
    return readAuthoritySnapshot({
      catalogueRawDigest: catalogue.snapshot.rawDigest,
      catalogueNormalizedDigest: await catalogueFingerprint(),
      policy: (currentEconomics as { costPolicy?: unknown }).costPolicy ?? null,
      authorizations: Object.freeze({
        projection: parseExecutionEconomicAuthorizations(currentEconomics),
        graphClosureDigest: economicsClosureDigest,
      }),
      installedAdapterPackages: currentAdapters,
      suppliedCredentialNames,
      transportCapabilities: currentCapabilities,
    });
  };

  // Read authority, then derive routes against exactly that reading.
  const authoritySnapshot = await snapshotNow();

  // A route that just refused is skipped while its bounded deferral stands, so
  // unattended operation does not re-pay the same refusal on every unit. The
  // set is frozen for the whole run: within one run every unit sees the same
  // availability picture.
  const deferralRecords = await readRouteDeferrals(repositoryRoot);
  const deferred = deferredCandidateIds(deferralRecords, Date.now());
  const observedRouteOutcomes: ObservedRouteOutcome[] = [];

  // 3. Dispatch independent work units under bounded parallelism.
  const { generateText } = await import("ai");
  const outcomes: UnitOutcome[] = [];
  let cursor = 0;
  const startWallMs = Date.now();

  async function runUnit(unit: SemanticWorkUnit, ordinal: number): Promise<UnitOutcome> {
    const universe = deriveRouteUniverse({
      snapshot: catalogue.snapshot,
      installedAdapterPackages: Object.freeze(installed),
      suppliedCredentialNames,
      authorizations,
      policy,
      requirement: Object.freeze({
        requiredCapabilities: unit.requiredCapabilities,
        minimumContextTokens: unit.minimumContextTokens,
        minimumOutputTokens: unit.maximumOutputTokens,
      }),
      observedAvailableRouteIds: observedRoutes,
      executionPolicy,
    credentialAliases: bindings.credentialAliases,
      providerEndpoints: bindings.endpoints,
      transportSelectedModel: bindings.transportSelectedModel,
      localAgentCapabilities,
    });
    // Spread units across providers so one quota failure cannot collapse the
    // batch. Currently deferred routes drop to the back rather than out: if
    // every eligible route is deferred, trying one is better than refusing.
    const spread = diversifyCandidates(universe.candidates, ordinal);
    const ordered = Object.freeze([
      ...spread.filter((candidate) => !deferred.has(candidate.candidateId)),
      ...spread.filter((candidate) => deferred.has(candidate.candidateId)),
    ]);
    const attempts: UnitAttempt[] = [];
    const startedAtMs = Date.now();

    // The bracket closes here: authority must still be the authority the route
    // was derived from. Nothing is dispatched on a stale selection.
    const beforeDispatch = await snapshotNow();
    if (beforeDispatch.snapshotDigest !== authoritySnapshot.snapshotDigest) {
      const moved = snapshotDifference(authoritySnapshot, beforeDispatch);
      attempts.push(Object.freeze({
        candidateId: ordered[0]?.candidateId ?? "(none)", transport: "(none)", provider: "(none)",
        model: null, startedAt: new Date().toISOString(), latencyMs: 0,
        outcome: "refused" as const, reasonCode: `AUTHORITY_MOVED:${moved.join("+")}`,
        statusCode: null, retryAfter: null, costIncurred: false,
      }));
      return Object.freeze({
        unit, candidatesConsidered: universe.candidates.length, attempts: Object.freeze(attempts),
        status: "refused" as const, selected: null, actualModel: null, invocationIdentity: null,
        text: null, usage: null, transportReportedCostUsd: null, startedAtMs, endedAtMs: Date.now(),
      });
    }

    for (const candidate of ordered.slice(0, maximumCandidateAttempts)) {
      const attemptStartedAt = new Date().toISOString();
      const attemptStarted = performance.now();
      try {
        if (candidate.transport === "claude-cli" || candidate.transport === "codex-cli"
          || candidate.transport === "antigravity-cli") {
          const produced = candidate.transport === "claude-cli"
            ? await invokeClaudeCli(unit.prompt, invocationTimeoutMs)
            : candidate.transport === "codex-cli"
              ? await invokeCodexCli(unit.prompt, invocationTimeoutMs)
              // Antigravity requires an explicit model identity; the candidate
              // carries none until its catalogue can be enumerated.
              : await invokeAntigravityCli(unit.prompt, candidate.model ?? "", invocationTimeoutMs);
          const elapsed = Math.round(performance.now() - attemptStarted);
          attempts.push(Object.freeze({
            candidateId: candidate.candidateId, transport: candidate.transport, provider: candidate.provider,
            model: candidate.model, startedAt: attemptStartedAt, latencyMs: elapsed,
            outcome: produced.outcome, reasonCode: produced.reasonCode, statusCode: null,
            retryAfter: produced.retryAfter, costIncurred: false,
          }));
          observedRouteOutcomes.push(Object.freeze({
            candidateId: candidate.candidateId,
            outcome: produced.outcome === "ok" && produced.text !== null && produced.text.trim().length > 0 ? "ok" : "refused",
            reasonCode: produced.reasonCode,
          }));
          if (produced.outcome === "ok" && produced.text !== null && produced.text.trim().length > 0) {
            return Object.freeze({
              unit, candidatesConsidered: universe.candidates.length, attempts: Object.freeze(attempts),
              status: "ok" as const, selected: candidate, actualModel: produced.actualModel,
              invocationIdentity: produced.invocationIdentity, text: produced.text,
              usage: Object.freeze({ inputTokens: produced.inputTokens, outputTokens: produced.outputTokens, totalTokens: produced.totalTokens }),
              transportReportedCostUsd: produced.transportReportedCostUsd,
              startedAtMs, endedAtMs: Date.now(),
            });
          }
          continue;
        }
        const credential = candidate.credentialName === null ? undefined : environment.getCredential(candidate.credentialName);
        if (credential === undefined || credential.length === 0 || candidate.adapterPackage === null || candidate.model === null) {
          attempts.push(Object.freeze({
            candidateId: candidate.candidateId, transport: candidate.transport, provider: candidate.provider,
            model: candidate.model, startedAt: attemptStartedAt, latencyMs: 0,
            outcome: "refused" as const, reasonCode: "CREDENTIAL_ABSENT", statusCode: null, retryAfter: null, costIncurred: false,
          }));
          observedRouteOutcomes.push(Object.freeze({ candidateId: candidate.candidateId, outcome: "refused" as const, reasonCode: "CREDENTIAL_ABSENT" }));
          continue;
        }
        const model = await languageModelFor(candidate.adapterPackage, candidate.model, credential, candidate.baseUrl);
        const produced = await generateText({
          model: model as Parameters<typeof generateText>[0]["model"],
          prompt: unit.prompt,
          maxOutputTokens: unit.maximumOutputTokens,
          abortSignal: AbortSignal.timeout(invocationTimeoutMs),
        });
        const elapsed = Math.round(performance.now() - attemptStarted);
        // A 200 that carries no text is a vacuous answer, not a result. It must
        // fall through to the next candidate: treating it as success would let
        // one silent model consume a work unit that another can complete.
        if (produced.text.trim().length === 0) {
          attempts.push(Object.freeze({
            candidateId: candidate.candidateId, transport: candidate.transport, provider: candidate.provider,
            model: candidate.model, startedAt: attemptStartedAt, latencyMs: elapsed,
            outcome: "refused" as const, reasonCode: `PROVIDER_EMPTY_RESULT:${produced.finishReason ?? "unknown"}`,
            statusCode: 200, retryAfter: null, costIncurred: false,
          }));
          observedRouteOutcomes.push(Object.freeze({
            candidateId: candidate.candidateId, outcome: "refused" as const,
            reasonCode: `PROVIDER_EMPTY_RESULT:${produced.finishReason ?? "unknown"}`,
          }));
          continue;
        }
        attempts.push(Object.freeze({
          candidateId: candidate.candidateId, transport: candidate.transport, provider: candidate.provider,
          model: candidate.model, startedAt: attemptStartedAt, latencyMs: elapsed,
          outcome: "ok" as const, reasonCode: "INVOCATION_OK", statusCode: 200, retryAfter: null, costIncurred: false,
        }));
        observedRouteOutcomes.push(Object.freeze({ candidateId: candidate.candidateId, outcome: "ok" as const, reasonCode: "INVOCATION_OK" }));
        return Object.freeze({
          unit, candidatesConsidered: universe.candidates.length, attempts: Object.freeze(attempts),
          status: "ok" as const, selected: candidate,
          actualModel: produced.response?.modelId ?? null, invocationIdentity: null,
          text: produced.text,
          usage: Object.freeze({
            inputTokens: produced.usage?.inputTokens ?? null,
            outputTokens: produced.usage?.outputTokens ?? null,
            totalTokens: produced.usage?.totalTokens ?? null,
          }),
          transportReportedCostUsd: null,
          startedAtMs, endedAtMs: Date.now(),
        });
      } catch (error) {
        const elapsed = Math.round(performance.now() - attemptStarted);
        const status = typeof (error as { statusCode?: unknown }).statusCode === "number"
          ? (error as { statusCode: number }).statusCode : null;
        const reasonCode = status === 402 ? "PROVIDER_QUOTA_EXHAUSTED_PAYMENT_REQUIRED"
          : status === 429 ? "PROVIDER_RATE_LIMITED"
          : status === 401 || status === 403 ? "PROVIDER_AUTHENTICATION_REFUSED"
          : status === 404 ? "PROVIDER_MODEL_NOT_SERVED"
          : error instanceof Error && error.name === "TimeoutError" ? "PROVIDER_TIMEOUT"
          : "PROVIDER_INVOCATION_FAILED";
        attempts.push(Object.freeze({
          candidateId: candidate.candidateId, transport: candidate.transport, provider: candidate.provider,
          model: candidate.model, startedAt: attemptStartedAt, latencyMs: elapsed,
          outcome: "refused" as const, reasonCode, statusCode: status, retryAfter: null, costIncurred: false,
        }));
        observedRouteOutcomes.push(Object.freeze({ candidateId: candidate.candidateId, outcome: "refused" as const, reasonCode }));
      }
    }
    return Object.freeze({
      unit, candidatesConsidered: universe.candidates.length, attempts: Object.freeze(attempts),
      status: "refused" as const, selected: null, actualModel: null, invocationIdentity: null,
      text: null, usage: null, transportReportedCostUsd: null, startedAtMs, endedAtMs: Date.now(),
    });
  }

  const workers = Array.from({ length: Math.min(parsed.concurrency, units.length) }, async () => {
    for (;;) {
      const ordinal = cursor++;
      if (ordinal >= units.length) return;
      outcomes.push(await runUnit(units[ordinal]!, ordinal));
    }
  });
  await Promise.all(workers);
  const endWallMs = Date.now();

  // 4. Concurrency evidence: the largest number of units in flight together.
  const events = outcomes.flatMap((outcome) => [
    { at: outcome.startedAtMs, delta: 1 },
    { at: outcome.endedAtMs, delta: -1 },
  ]).sort((left, right) => left.at - right.at || left.delta - right.delta);
  let inFlight = 0;
  let peakConcurrency = 0;
  for (const event of events) {
    inFlight += event.delta;
    peakConcurrency = Math.max(peakConcurrency, inFlight);
  }
  const serialMs = outcomes.reduce((total, outcome) => total + (outcome.endedAtMs - outcome.startedAtMs), 0);
  const wallMs = endWallMs - startWallMs;

  // 5. Result graph with provenance from source assertion to result.
  const ordered = Object.freeze([...outcomes].sort((left, right) => left.unit.iri.localeCompare(right.unit.iri)));
  const resultGraph = `${parsed.graph}:results`;
  const resultQuads: Quad[] = [];
  const quad = (subject: string, predicate: string, object: string, objectKind: "iri" | "literal"): void => {
    const built = { subject, predicate, object, objectKind, graph: resultGraph, canonical: "" };
    built.canonical = canonicalQuadLine(built);
    resultQuads.push(built);
  };
  for (const outcome of ordered) {
    const resultIri = `urn:usf:execution-result:${canonicalDigest({
      unit: outcome.unit.iri,
      sourceAssertionDigest: outcome.unit.sourceAssertionDigest,
      text: outcome.text,
      selected: outcome.selected?.candidateId ?? null,
    }).slice("sha256:".length)}`;
    quad(resultIri, typePredicate, "urn:usf:type:ExecutionResult", "iri");
    quad(resultIri, "urn:usf:predicate:derivedFrom", outcome.unit.iri, "iri");
    quad(outcome.unit.iri, "urn:usf:predicate:executionResult", resultIri, "iri");
    quad(resultIri, "urn:usf:predicate:sourceAssertionDigest", outcome.unit.sourceAssertionDigest, "literal");
    quad(resultIri, "urn:usf:predicate:sourceGraphDigest", sourceGraphDigest, "literal");
    quad(resultIri, "urn:usf:predicate:executionStatus", outcome.status, "literal");
    for (const dependency of dependencyGraph.dependencies.get(outcome.unit.iri) ?? []) {
      quad(resultIri, "urn:usf:predicate:satisfiedDependency", dependency, "iri");
    }
    if (outcome.selected !== null) {
      quad(resultIri, "urn:usf:predicate:executionTransport", outcome.selected.transport, "literal");
      quad(resultIri, "urn:usf:predicate:selectedProvider", outcome.selected.provider, "literal");
      quad(resultIri, "urn:usf:predicate:catalogueCostClass", outcome.selected.costClass, "literal");
      if (outcome.selected.economicBasis !== null) {
        quad(resultIri, "urn:usf:predicate:economicBasis", outcome.selected.economicBasis, "literal");
      }
      if (outcome.selected.model !== null) quad(resultIri, "urn:usf:predicate:requestedModel", outcome.selected.model, "literal");
    }
    // An identity the transport does not expose is recorded as an explicit non-claim.
    if (outcome.actualModel !== null) quad(resultIri, "urn:usf:predicate:actualModel", outcome.actualModel, "literal");
    else if (outcome.status === "ok") quad(resultIri, "urn:usf:predicate:actualModelUnobservable", "true", "literal");
    if (outcome.invocationIdentity !== null) quad(resultIri, "urn:usf:predicate:invocationIdentity", outcome.invocationIdentity, "literal");
    if (outcome.text !== null) {
      quad(resultIri, "urn:usf:predicate:resultText", outcome.text, "literal");
      quad(resultIri, "urn:usf:predicate:resultDigest", canonicalDigest(outcome.text), "literal");
    }
    if (outcome.usage?.totalTokens !== null && outcome.usage !== null) {
      quad(resultIri, "urn:usf:predicate:totalTokens", String(outcome.usage.totalTokens), "literal");
    }
    for (const attempt of outcome.attempts) {
      quad(resultIri, "urn:usf:predicate:attemptDisposition", `${attempt.candidateId}=${attempt.reasonCode}`, "literal");
    }
  }
  const resultGraphDigest = canonicalQuadDigest(resultQuads);
  const resultGraphText = `${resultQuads.map((entry) => entry.canonical).sort().join("\n")}\n`;

  const succeeded = ordered.filter((outcome) => outcome.status === "ok").length;
  const evidence = Object.freeze({
    schema: "urn:usf:graph-execution-evidence:1" as const,
    version: 1 as const,
    status: succeeded === ordered.length ? "ok" as const : succeeded === 0 ? "refused" as const : "partial" as const,
    observedAt,
    sourceGraph: parsed.graph,
    sourceGraphDigest,
    economicsClosureDigest,
    resultGraph,
    resultGraphDigest,
    workUnitCount: ordered.length,
    declaredUnitCount: allUnits.length,
    dependencyEdgeCount: [...dependencyGraph.dependencies.values()].reduce((total, edges) => total + edges.length, 0),
    dependencyAcyclic: dependencyGraph.acyclic,
    selectedUnits: parsed.only,
    externallySatisfiedDependencies: parsed.satisfiedDependencies,
    succeededCount: succeeded,
    authoritySnapshot,
    catalogue: Object.freeze({
      rawDigest: catalogue.snapshot.rawDigest,
      normalizedDigest: catalogue.snapshot.normalizedDigest,
      providerCount: catalogue.snapshot.providers.length,
    }),
    concurrency: Object.freeze({
      requested: parsed.concurrency,
      peakObserved: peakConcurrency,
      wallClockMs: wallMs,
      summedUnitMs: serialMs,
      // Above 1.0 only when unit executions genuinely overlapped in time.
      parallelSpeedupRatio: wallMs === 0 ? null : Number((serialMs / wallMs).toFixed(3)),
    }),
    localAgentDispositions: Object.freeze(localAgentCapabilities.map((capability) => Object.freeze({
      transport: capability.transport, usable: capability.usable, reason: capability.reason,
    }))),
    units: Object.freeze(ordered.map((outcome) => Object.freeze({
      unit: outcome.unit.iri,
      sourceAssertionDigest: outcome.unit.sourceAssertionDigest,
      requiredCapabilities: outcome.unit.requiredCapabilities,
      candidatesConsidered: outcome.candidatesConsidered,
      attempts: outcome.attempts,
      status: outcome.status,
      selectedCandidateId: outcome.selected?.candidateId ?? null,
      transport: outcome.selected?.transport ?? null,
      actualModel: outcome.actualModel,
      invocationIdentity: outcome.invocationIdentity,
      usage: outcome.usage,
      transportReportedCostUsd: outcome.transportReportedCostUsd,
      resultDigest: outcome.text === null ? null : canonicalDigest(outcome.text),
      resultText: outcome.text,
    }))),
    nonClaims: Object.freeze([
      "Each result is bound to the exact source quads that asserted its work unit. Provenance is by digest, not by narration.",
      "A transport that does not expose its resolved model identity is recorded as unobservable rather than assigned an invented model.",
      "Costs a transport reports for a subscription are list-basis attribution, not charges against this repository.",
      "Refusals are provider-stated facts; a usage-limit refusal denies access without performing paid work.",
      "Every dispatch was preceded by a re-read of the semantic authority the route was derived from. A unit refused with AUTHORITY_MOVED was never dispatched on a stale selection.",
      "A deferred route is one this repository observed refusing recently. The deferral is local, bounded, self-expiring and per exact route; it is not a provider-family disablement and asserts nothing about the provider.",
    ]),
    deferredRouteCount: deferred.size,
  });

  // Availability memory is folded in once, after the run, so a route deferred
  // mid-run still receives every observation this run made about it.
  await writeRouteDeferrals(repositoryRoot,
    applyRouteOutcomes(deferralRecords, observedRouteOutcomes, Date.now()));

  const evidenceDirectory = resolve(repositoryRoot, ".usf", "graph-executions");
  await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
  const evidenceDigest = canonicalDigest(evidence);
  await writeFile(
    resolve(evidenceDirectory, `${evidenceDigest.slice("sha256:".length)}.json`),
    `${JSON.stringify(evidence, null, 1)}\n`,
    { mode: 0o600 },
  );
  await writeFile(
    resolve(evidenceDirectory, `${evidenceDigest.slice("sha256:".length)}.result.nq`),
    resultGraphText,
    { mode: 0o600 },
  );
  if (parsed.outputPath !== null) {
    await writeFile(resolve(repositoryRoot, parsed.outputPath), resultGraphText, { mode: 0o600 });
  }

  return {
    output: Object.freeze({ ...evidence, evidenceDigest }),
    exitCode: (evidence.status === "ok" ? exitCodes.SUCCESS
      : evidence.status === "partial" ? exitCodes.CONTINUOUS_DEGRADED
      : exitCodes.EXTERNAL_UNAVAILABLE) as ExitCode,
  };
}
