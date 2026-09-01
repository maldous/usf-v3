import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { canonicalDigest } from "../core/canonical.ts";
import { exitCodes, UsfError, type ExitCode } from "../core/errors.ts";
import { canonicalQuadDigest, canonicalQuadLine, parseStrictNQuads, type Quad } from "../graph/nquads.ts";
import type { CommandResult } from "./dispatcher.ts";
import { graphExecuteCommand } from "./graph-execute.ts";
import { graphIntegrityCommand } from "./graph-integrity.ts";
import { readLocalCatalogue } from "./models.ts";
import { readTrackedJson } from "./probe.ts";

const stateGraph = "urn:usf:graph:hermes-state";
const typePredicate = "urn:usf:predicate:type";
const workUnitType = "urn:usf:type:SemanticWorkUnit";
const executionResultPredicate = "urn:usf:predicate:executionResult";
const attemptCountPredicate = "urn:usf:predicate:hermesAttemptCount";
const maximumCyclesCeiling = 12;
const maximumAttemptsPerUnit = 3;

function invalid(message: string): never {
  throw new UsfError("HERMES_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, message);
}

interface ParsedArguments {
  readonly envFile: string;
  readonly workDirectory: string;
  readonly maximumCycles: number;
  readonly concurrency: number;
}

function parse(args: readonly string[], requireEnvFile: boolean): ParsedArguments {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index]!;
    if (!["--env-file", "--work-dir", "--max-cycles", "--concurrency"].includes(option) || values.has(option)) {
      invalid(`Hermes options must be unique and explicit: ${option}`);
    }
    const value = args[++index];
    if (value === undefined || value.length === 0 || value.startsWith("--")) invalid(`Missing value for ${option}.`);
    values.set(option, value);
  }
  const envFile = values.get("--env-file");
  if (envFile === undefined && requireEnvFile) invalid("Hermes run requires --env-file.");
  const cyclesText = values.get("--max-cycles") ?? "3";
  if (!/^[1-9][0-9]?$/u.test(cyclesText)) invalid("--max-cycles must be a positive integer.");
  const maximumCycles = Number(cyclesText);
  if (maximumCycles > maximumCyclesCeiling) invalid("--max-cycles exceeds the bounded ceiling.");
  const concurrencyText = values.get("--concurrency") ?? "4";
  if (!/^[1-9][0-9]?$/u.test(concurrencyText)) invalid("--concurrency must be a positive integer.");
  return Object.freeze({
    envFile: envFile ?? ".usf/credentials/providers.env",
    workDirectory: values.get("--work-dir") ?? ".usf/work",
    maximumCycles,
    concurrency: Number(concurrencyText),
  });
}

interface DiscoveredWork {
  readonly file: string;
  readonly graph: string;
  readonly unitIris: readonly string[];
  readonly quads: readonly Quad[];
}

/**
 * Find every semantic work graph Hermes owns. The graph IRI is read from the
 * quads themselves so no external instruction is needed to name it.
 */
async function discoverWork(repositoryRoot: string, workDirectory: string): Promise<readonly DiscoveredWork[]> {
  const directory = resolve(repositoryRoot, workDirectory);
  const names = await readdir(directory).catch(() => [] as string[]);
  const discovered: DiscoveredWork[] = [];
  for (const name of names.filter((entry) => entry.endsWith(".nq")).sort()) {
    if (name.endsWith(".result.nq") || name.endsWith("-results.nq")) continue;
    const source = await readFile(resolve(directory, name), "utf8").catch(() => undefined);
    if (source === undefined) continue;
    const graphMatch = /<([^>]+)> \.$/mu.exec(source.split("\n").find((line) => line.trim().length > 0) ?? "");
    const graph = graphMatch?.[1];
    if (graph === undefined) continue;
    let quads: Quad[];
    try { quads = parseStrictNQuads(source, graph, 20_000); } catch { continue; }
    const unitIris = Object.freeze([...new Set(quads
      .filter((quad) => quad.predicate === typePredicate && quad.objectKind === "iri" && quad.object === workUnitType)
      .map((quad) => quad.subject))].sort());
    if (unitIris.length === 0) continue;
    discovered.push(Object.freeze({ file: `${workDirectory}/${name}`, graph, unitIris, quads: Object.freeze(quads) }));
  }
  return Object.freeze(discovered);
}

async function readStateQuads(repositoryRoot: string): Promise<readonly Quad[]> {
  const path = resolve(repositoryRoot, ".usf", "hermes", "state.nq");
  const source = await readFile(path, "utf8").catch(() => undefined);
  if (source === undefined || source.trim().length === 0) return Object.freeze([]);
  try { return Object.freeze(parseStrictNQuads(source, stateGraph, 200_000)); } catch { return Object.freeze([]); }
}

function quadOf(subject: string, predicate: string, object: string, objectKind: "iri" | "literal"): Quad {
  const built = { subject, predicate, object, objectKind, graph: stateGraph, canonical: "" };
  built.canonical = canonicalQuadLine(built);
  return built;
}

export async function hermesCommand(repositoryRoot: string, args: readonly string[]): Promise<CommandResult> {
  const operation = args[0];
  if (operation !== "run" && operation !== "status") {
    throw new UsfError("HERMES_OPERATION_UNKNOWN", exitCodes.INVALID_INPUT, "Hermes requires exactly one of: run, status.");
  }
  const parsed = parse(args.slice(1), operation === "run");

  // Authority inspection: what V3 state Hermes is operating against.
  const catalogue = await readLocalCatalogue(repositoryRoot);
  const economics = await readTrackedJson(repositoryRoot, "config/execution-economics.json");
  const policy = await readTrackedJson(repositoryRoot, "config/policy.json");
  // Hermes inspects the consolidated semantic corpus itself, not only operator
  // configuration: a non-conforming corpus is an authority fact it must report.
  const integrity = await graphIntegrityCommand(repositoryRoot, []).then(
    (result) => result.output as Record<string, unknown>,
    () => undefined,
  );
  const authority = Object.freeze({
    catalogueRawDigest: catalogue.snapshot.rawDigest,
    catalogueNormalizedDigest: catalogue.snapshot.normalizedDigest,
    catalogueProviderCount: catalogue.snapshot.providers.length,
    catalogueModelCount: catalogue.snapshot.providers.reduce((total, provider) => total + provider.models.length, 0),
    economicAuthorizationDigest: canonicalDigest(economics),
    costPolicyDigest: canonicalDigest(policy),
    corpus: Object.freeze({
      quadCount: integrity?.quadCount ?? null,
      subjectCount: integrity?.subjectCount ?? null,
      checkedInvariantCount: Array.isArray(integrity?.checkedCodes) ? integrity.checkedCodes.length : null,
      ownedGraphViolationCount: integrity?.ownedGraphViolationCount ?? null,
      recordedLegacyDebtCount: integrity?.legacyGraphViolationCount ?? null,
      gateConforming: integrity?.gateConforming ?? null,
    }),
  });

  const discovered = await discoverWork(repositoryRoot, parsed.workDirectory);
  let state = [...await readStateQuads(repositoryRoot)];

  const completedUnits = (): Set<string> => new Set(state
    .filter((quad) => quad.predicate === executionResultPredicate)
    .map((quad) => quad.subject));
  const attemptsFor = (unit: string): number => {
    const values = state
      .filter((quad) => quad.subject === unit && quad.predicate === attemptCountPredicate)
      .map((quad) => Number(quad.object))
      .filter((value) => Number.isSafeInteger(value));
    return values.length === 0 ? 0 : Math.max(...values);
  };

  const pendingUnits = (): readonly Readonly<{ work: DiscoveredWork; unit: string }>[] => {
    const done = completedUnits();
    return Object.freeze(discovered.flatMap((work) => work.unitIris
      .filter((unit) => !done.has(unit) && attemptsFor(unit) < maximumAttemptsPerUnit)
      .map((unit) => Object.freeze({ work, unit }))));
  };

  if (operation === "status") {
    const done = completedUnits();
    return {
      output: Object.freeze({
        schema: "urn:usf:hermes-status:1" as const,
        version: 1 as const,
        authority,
        workGraphs: Object.freeze(discovered.map((work) => Object.freeze({
          file: work.file, graph: work.graph, unitCount: work.unitIris.length,
          completedCount: work.unitIris.filter((unit) => done.has(unit)).length,
        }))),
        stateQuadCount: state.length,
        completedUnitCount: done.size,
        pendingUnitCount: pendingUnits().length,
        readyToRun: pendingUnits().length > 0,
      }),
      exitCode: exitCodes.SUCCESS,
    };
  }

  const cycleDirectory = resolve(repositoryRoot, ".usf", "hermes");
  await mkdir(cycleDirectory, { recursive: true, mode: 0o700 });

  const cycles: unknown[] = [];
  let terminalState = "idle-no-pending-work";

  for (let cycle = 1; cycle <= parsed.maximumCycles; cycle += 1) {
    const pending = pendingUnits();
    if (pending.length === 0) {
      terminalState = cycle === 1 ? "idle-no-pending-work" : "all-work-terminal";
      break;
    }

    // Compose one cycle graph from exactly the pending units' own assertions.
    const byGraph = new Map<string, { work: DiscoveredWork; units: string[] }>();
    for (const entry of pending) {
      const bucket = byGraph.get(entry.work.graph) ?? { work: entry.work, units: [] };
      bucket.units.push(entry.unit);
      byGraph.set(entry.work.graph, bucket);
    }
    // One cycle drives one work graph; remaining graphs follow in later cycles.
    const [selectedGraph, selected] = [...byGraph.entries()].sort(([left], [right]) => left.localeCompare(right))[0]!;
    const cycleQuads = selected.work.quads.filter((quad) => selected.units.includes(quad.subject));
    const cyclePath = `.usf/hermes/cycle-${cycle}.nq`;
    await writeFile(
      resolve(repositoryRoot, cyclePath),
      `${cycleQuads.map((quad) => quad.canonical).sort().join("\n")}\n`,
      { mode: 0o600 },
    );

    // Route and dispatch. Hermes chooses no provider or model itself; the route
    // universe and economic policy decide, and refusals are recovered by
    // re-queueing the unit for a later cycle with a different provider offset.
    const executed = await graphExecuteCommand(repositoryRoot, [
      "--input", cyclePath,
      "--graph", selectedGraph,
      "--env-file", parsed.envFile,
      "--concurrency", String(parsed.concurrency),
    ]).catch((error: unknown) => ({
      output: Object.freeze({ status: "refused", failure: error instanceof Error ? error.message.slice(0, 200) : "unknown" }),
      exitCode: exitCodes.EXTERNAL_UNAVAILABLE as ExitCode,
    }));
    const evidence = executed.output as Record<string, unknown>;

    // Merge results into durable semantic state.
    const units = Array.isArray(evidence.units) ? evidence.units as Record<string, unknown>[] : [];
    let advanced = 0;
    for (const unitRecord of units) {
      const unitIri = typeof unitRecord.unit === "string" ? unitRecord.unit : null;
      if (unitIri === null) continue;
      const attempts = attemptsFor(unitIri) + 1;
      state = state.filter((quad) => !(quad.subject === unitIri && quad.predicate === attemptCountPredicate));
      state.push(quadOf(unitIri, attemptCountPredicate, String(attempts), "literal"));
      if (unitRecord.status !== "ok") continue;
      const resultDigest = typeof unitRecord.resultDigest === "string" ? unitRecord.resultDigest : null;
      const resultIri = `urn:usf:execution-result:${(resultDigest ?? canonicalDigest(unitRecord)).slice("sha256:".length)}`;
      state.push(quadOf(unitIri, executionResultPredicate, resultIri, "iri"));
      state.push(quadOf(resultIri, typePredicate, "urn:usf:type:ExecutionResult", "iri"));
      state.push(quadOf(resultIri, "urn:usf:predicate:derivedFrom", unitIri, "iri"));
      if (typeof unitRecord.sourceAssertionDigest === "string") {
        state.push(quadOf(resultIri, "urn:usf:predicate:sourceAssertionDigest", unitRecord.sourceAssertionDigest, "literal"));
      }
      if (typeof unitRecord.transport === "string") {
        state.push(quadOf(resultIri, "urn:usf:predicate:executionTransport", unitRecord.transport, "literal"));
      }
      if (typeof unitRecord.actualModel === "string") {
        state.push(quadOf(resultIri, "urn:usf:predicate:actualModel", unitRecord.actualModel, "literal"));
      }
      if (typeof unitRecord.resultText === "string") {
        state.push(quadOf(resultIri, "urn:usf:predicate:resultText", unitRecord.resultText, "literal"));
      }
      if (resultDigest !== null) {
        state.push(quadOf(resultIri, "urn:usf:predicate:resultDigest", resultDigest, "literal"));
      }
      state.push(quadOf(resultIri, "urn:usf:predicate:hermesCycle", String(cycle), "literal"));
      advanced += 1;
    }

    cycles.push(Object.freeze({
      cycle,
      workGraph: selectedGraph,
      cycleGraphPath: cyclePath,
      dispatchedUnitCount: selected.units.length,
      advancedUnitCount: advanced,
      graphExecutionStatus: evidence.status ?? "unknown",
      graphExecutionEvidenceDigest: evidence.evidenceDigest ?? null,
      concurrency: evidence.concurrency ?? null,
      transportsUsed: Object.freeze([...new Set(units
        .filter((unit) => unit.status === "ok" && typeof unit.transport === "string")
        .map((unit) => unit.transport as string))].sort()),
      refusals: Object.freeze(units
        .filter((unit) => unit.status !== "ok")
        .map((unit) => Object.freeze({ unit: unit.unit, attempts: unit.attempts }))),
    }));

    if (advanced === 0 && pendingUnits().length === pending.length) {
      terminalState = "blocked-no-progress";
      break;
    }
    terminalState = pendingUnits().length === 0 ? "all-work-terminal" : "cycles-exhausted";
  }

  // Persist the semantic state graph.
  const orderedState = Object.freeze([...new Map(state.map((quad) => [quad.canonical, quad])).values()]
    .sort((left, right) => left.canonical.localeCompare(right.canonical)));
  await writeFile(
    resolve(repositoryRoot, ".usf", "hermes", "state.nq"),
    `${orderedState.map((quad) => quad.canonical).join("\n")}\n`,
    { mode: 0o600 },
  );

  const done = new Set(orderedState.filter((quad) => quad.predicate === executionResultPredicate).map((quad) => quad.subject));
  const report = Object.freeze({
    schema: "urn:usf:hermes-cycle-report:1" as const,
    version: 1 as const,
    observedAt: new Date().toISOString(),
    operator: "hermes",
    authority,
    terminalState,
    cyclesRun: cycles.length,
    cycles: Object.freeze(cycles),
    stateGraph,
    stateQuadCount: orderedState.length,
    stateGraphDigest: canonicalQuadDigest(orderedState),
    completedUnitCount: done.size,
    totalUnitCount: discovered.reduce((total, work) => total + work.unitIris.length, 0),
    nonClaims: Object.freeze([
      "Hermes selected no provider or model itself. Each route was derived from the catalogue classification, transport capability and economic policy in force at dispatch time.",
      "A refused unit is re-queued for a later cycle up to a bounded attempt count; exhausting that bound is recorded, never retried indefinitely.",
      "The state graph records what executed. It asserts no construction, completion, publication or Git authority.",
    ]),
  });

  await writeFile(
    resolve(repositoryRoot, ".usf", "hermes", `cycle-report-${canonicalDigest(report).slice("sha256:".length)}.json`),
    `${JSON.stringify(report, null, 1)}\n`,
    { mode: 0o600 },
  );

  return {
    output: report,
    exitCode: (terminalState === "all-work-terminal" || terminalState === "idle-no-pending-work"
      ? exitCodes.SUCCESS
      : terminalState === "blocked-no-progress" ? exitCodes.EXTERNAL_UNAVAILABLE
      : exitCodes.CONTINUOUS_DEGRADED) as ExitCode,
  };
}
