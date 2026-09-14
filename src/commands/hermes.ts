import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, readdir, readFile, rename, unlink } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { canonicalDigest } from "../core/canonical.ts";
import { exitCodes, UsfError, type ExitCode } from "../core/errors.ts";
import { canonicalQuadDigest, canonicalQuadLine, parseStrictNQuads, type Quad } from "../graph/nquads.ts";
import { deriveStates, readDependencyGraph, readyUnits, stateCounts, type WorkUnitState } from "../graph/work-dependency.ts";
import type { CommandResult } from "./dispatcher.ts";
import { graphExecuteCommand } from "./graph-execute.ts";
import { graphIntegrityCommand } from "./graph-integrity.ts";
import {
  LinearBindingError,
  afterHermesRefusal,
  afterHermesResult,
  beforeHermesDispatch,
  observeLinearBinding,
  type LinearBindingSelector,
} from "./linear-binding.ts";
import { readLocalCatalogue } from "./models.ts";
import { readTrackedJson } from "./probe.ts";

const stateGraph = "urn:usf:graph:hermes-state";
const typePredicate = "urn:usf:predicate:type";
const workUnitType = "urn:usf:type:SemanticWorkUnit";
const executionResultPredicate = "urn:usf:predicate:executionResult";
const attemptCountPredicate = "urn:usf:predicate:hermesAttemptCount";
const bindingIriPredicate = "urn:usf:predicate:bindingIri";
const bindingManifestPathPredicate = "urn:usf:predicate:bindingManifestPath";
const maximumCyclesCeiling = 12;
const maximumAttemptsPerUnit = 3;
const privateDirectoryMode = 0o700;
const privateFileMode = 0o600;
let stateWriteQueue: Promise<void> = Promise.resolve();

function invalid(message: string): never {
  throw new UsfError("HERMES_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, message);
}

interface ParsedArguments {
  readonly envFile: string;
  readonly workDirectory: string;
  readonly maximumCycles: number;
  readonly concurrency: number;
  readonly bindingIri: string | undefined;
}

function parse(args: readonly string[], requireEnvFile: boolean): ParsedArguments {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index]!;
    if (!["--env-file", "--work-dir", "--max-cycles", "--concurrency", "--binding"].includes(option) || values.has(option)) {
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
    bindingIri: values.get("--binding"),
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

function oneObject(work: DiscoveredWork, unitIri: string, predicate: string, objectKind: "iri" | "literal"): string | undefined {
  const matches = work.quads.filter((quad) => quad.subject === unitIri && quad.predicate === predicate);
  if (matches.length === 0) return undefined;
  if (matches.length !== 1 || matches[0]!.objectKind !== objectKind || matches[0]!.object.length === 0) {
    throw new UsfError("HERMES_LINEAR_BINDING_METADATA_INVALID", exitCodes.INVALID_INPUT, `Bound Hermes metadata must contain one non-empty ${objectKind} per field.`);
  }
  return matches[0]!.object;
}

export function bindingSelector(repositoryRoot: string, work: DiscoveredWork): LinearBindingSelector | undefined {
  const metadata = work.unitIris.map((unitIri) => Object.freeze({
    bindingIri: oneObject(work, unitIri, bindingIriPredicate, "iri"),
    manifestPath: oneObject(work, unitIri, bindingManifestPathPredicate, "literal"),
  }));
  const hasBindingMetadata = metadata.some(
    (entry) => entry.bindingIri !== undefined || entry.manifestPath !== undefined,
  );
  if (!hasBindingMetadata) return undefined;
  const boundMetadata = metadata[0]!;
  if (work.unitIris.length !== 1
    || boundMetadata.bindingIri === undefined
    || boundMetadata.manifestPath === undefined) {
    throw new UsfError("HERMES_LINEAR_BINDING_METADATA_INVALID", exitCodes.INVALID_INPUT, "A native bound graph must contain exactly one unit and complete binding metadata.");
  }
  return Object.freeze({
    repositoryRoot,
    manifestPath: boundMetadata.manifestPath,
    bindingIri: boundMetadata.bindingIri,
  });
}

async function selectCurrentBindingWork(
  repositoryRoot: string,
  discovered: readonly DiscoveredWork[],
  requestedBindingIri: string,
): Promise<readonly DiscoveredWork[]> {
  const matchingBinding = discovered.filter((work) => work.quads.some((quad) =>
    work.unitIris.includes(quad.subject)
    && quad.predicate === bindingIriPredicate
    && quad.objectKind === "iri"
    && quad.object === requestedBindingIri));
  const current: DiscoveredWork[] = [];
  const completedSelectors = new Map<string, LinearBindingSelector>();
  for (const work of matchingBinding) {
    const selector = bindingSelector(repositoryRoot, work);
    if (selector === undefined || selector.bindingIri !== requestedBindingIri) continue;
    let observed;
    try {
      observed = await observeLinearBinding(selector);
    } catch (error) {
      if (error instanceof LinearBindingError) {
        throw new UsfError(error.reasonCode, exitCodes.DOMAIN_FAILURE, error.reasonCode);
      }
      throw error;
    }
    if (observed.status === "COMPLETED") {
      completedSelectors.set(canonicalDigest(selector), selector);
      continue;
    }
    if (work.unitIris.length === 1
      && observed.binding.unit.unitIri === work.unitIris[0]
      && observed.binding.unit.bindingIri === requestedBindingIri
      && observed.binding.unit.bindingManifestPath === selector.manifestPath
      && observed.binding.unitPath === work.file) {
      current.push(work);
    }
  }
  // Completion is terminal and deliberately does not recreate private work.
  if (completedSelectors.size === 1 && current.length === 0) return Object.freeze([]);
  if (current.length !== 1) {
    throw new UsfError(
      "HERMES_LINEAR_BINDING_NOT_CURRENT",
      exitCodes.DOMAIN_FAILURE,
      "Hermes requires exactly one prepared graph matching the current derived binding identity.",
    );
  }
  return Object.freeze(current);
}

async function verifyBoundWork(repositoryRoot: string, work: DiscoveredWork, unitIri: string, selector: LinearBindingSelector) {
  try {
    const observed = await observeLinearBinding(selector);
    const binding = observed.binding;
    if (binding.unit.unitIri !== unitIri
      || binding.unit.bindingIri !== selector.bindingIri
      || binding.unit.bindingManifestPath !== selector.manifestPath
      || binding.unit.manifestPath !== binding.authority.targetManifest
      || binding.unitPath !== work.file) {
      throw new UsfError("HERMES_LINEAR_BINDING_IDENTITY_MISMATCH", exitCodes.INVALID_INPUT, "The discovered bound unit does not match current binding authority.");
    }
    const [discoveredBytes, trustedBytes] = await Promise.all([
      readFile(resolve(repositoryRoot, work.file), "utf8"),
      readFile(resolve(repositoryRoot, binding.unitPath), "utf8"),
    ]);
    if (discoveredBytes !== trustedBytes) {
      throw new UsfError("HERMES_LINEAR_BINDING_GRAPH_MISMATCH", exitCodes.INVALID_INPUT, "The discovered bound graph bytes are not the prepared unit graph.");
    }
    return observed;
  } catch (error) {
    if (error instanceof LinearBindingError) throw new UsfError(error.reasonCode, exitCodes.DOMAIN_FAILURE, error.reasonCode);
    throw error;
  }
}

async function readStateQuads(repositoryRoot: string): Promise<readonly Quad[]> {
  const path = resolve(repositoryRoot, ".usf", "hermes", "state.nq");
  const source = await readFile(path, "utf8").catch(() => undefined);
  if (source === undefined || source.trim().length === 0) return Object.freeze([]);
  try { return Object.freeze(parseStrictNQuads(source, stateGraph, 200_000)); } catch { return Object.freeze([]); }
}

function canonicalState(quads: readonly Quad[]): readonly Quad[] {
  const normalized = quads.map((quad) => Object.freeze({ ...quad, canonical: canonicalQuadLine(quad) }));
  return Object.freeze([...new Map(normalized.map((quad) => [quad.canonical, quad])).values()]
    .sort((left, right) => left.canonical.localeCompare(right.canonical)));
}

function maximumAttempt(quads: readonly Quad[], unitIri: string): number | undefined {
  const attempts = quads
    .filter((quad) => quad.subject === unitIri && quad.predicate === attemptCountPredicate && quad.objectKind === "literal")
    .map((quad) => Number(quad.object))
    .filter((value) => Number.isSafeInteger(value) && value >= 0);
  return attempts.length === 0 ? undefined : Math.max(...attempts);
}

/**
 * Merges only state material produced by this call. Attempt counters are
 * monotonic maxima, and result subgraphs are canonical-set unions, so a stale
 * caller cannot erase an independent binding's result or inflate a replay.
 */
export function mergeHermesState(
  current: readonly Quad[],
  local: readonly Quad[],
  changedUnitIris: readonly string[],
): readonly Quad[] {
  const changed = new Set(changedUnitIris);
  const merged = current.filter((quad) => !(changed.has(quad.subject) && quad.predicate === attemptCountPredicate));
  const additions: Quad[] = [];
  for (const unitIri of [...changed].sort()) {
    const localAttempts = maximumAttempt(local, unitIri);
    const currentAttempts = maximumAttempt(current, unitIri);
    const attempts = Math.max(localAttempts ?? 0, currentAttempts ?? 0);
    if (localAttempts !== undefined || currentAttempts !== undefined) additions.push(quadOf(unitIri, attemptCountPredicate, String(attempts), "literal"));
    const resultIris = local
      .filter((quad) => quad.subject === unitIri && quad.predicate === executionResultPredicate && quad.objectKind === "iri")
      .map((quad) => quad.object);
    for (const resultIri of resultIris) {
      additions.push(...local.filter((quad) => quad.subject === unitIri && quad.predicate === executionResultPredicate && quad.object === resultIri));
      additions.push(...local.filter((quad) => quad.subject === resultIri));
    }
  }
  return canonicalState([...merged, ...additions]);
}

function statePath(repositoryRoot: string): string {
  const root = resolve(repositoryRoot);
  const path = resolve(root, ".usf", "hermes", "state.nq");
  if (relative(root, path).startsWith("..")) throw new UsfError("HERMES_STATE_PATH_UNSAFE", exitCodes.CONTAINMENT_REFUSAL, "Hermes state path escapes the repository.");
  return path;
}

async function secureHermesDirectory(repositoryRoot: string): Promise<string> {
  const root = resolve(repositoryRoot);
  const directory = dirname(statePath(root));
  await mkdir(directory, { recursive: true, mode: privateDirectoryMode });
  const metadata = await lstat(directory).catch(() => undefined);
  if (metadata === undefined || !metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0) {
    throw new UsfError("HERMES_STATE_PATH_UNSAFE", exitCodes.CONTAINMENT_REFUSAL, "Hermes state directory is not private and direct.");
  }
  return directory;
}

async function writePrivateAtomic(path: string, bytes: string, replace: boolean): Promise<void> {
  const directory = dirname(path);
  const temporary = resolve(directory, `.state-${process.pid}-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), privateFileMode);
    await handle.writeFile(bytes, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    if (replace) {
      const prior = await lstat(path).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? undefined : Promise.reject(error));
      if (prior !== undefined && (!prior.isFile() || prior.isSymbolicLink() || prior.nlink !== 1 || (prior.mode & 0o077) !== 0)) {
        throw new UsfError("HERMES_STATE_PATH_UNSAFE", exitCodes.CONTAINMENT_REFUSAL, "Hermes state file is not private and regular.");
      }
      await rename(temporary, path);
    } else {
      try { await link(temporary, path); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const metadata = await lstat(path);
        if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || (metadata.mode & 0o077) !== 0) {
          throw new UsfError("HERMES_STATE_PATH_UNSAFE", exitCodes.CONTAINMENT_REFUSAL, "Content-addressed Hermes report is not private and regular.");
        }
        const existing = await readFile(path, "utf8");
        if (existing !== bytes) throw new UsfError("HERMES_REPORT_COLLISION", exitCodes.CONTAINMENT_REFUSAL, "Content-addressed Hermes report path contains different bytes.");
      }
    }
    const directoryHandle = await open(directory, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0));
    try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
  } finally {
    await handle?.close();
    await unlink(temporary).catch(() => undefined);
  }
}

function serializeStateWrite<T>(operation: () => Promise<T>): Promise<T> {
  const run = stateWriteQueue.then(operation, operation);
  stateWriteQueue = run.then(() => undefined, () => undefined);
  return run;
}

async function persistMergedState(repositoryRoot: string, local: readonly Quad[], changedUnitIris: readonly string[]): Promise<readonly Quad[]> {
  return serializeStateWrite(async () => {
    await secureHermesDirectory(repositoryRoot);
    const merged = mergeHermesState(await readStateQuads(repositoryRoot), local, changedUnitIris);
    await writePrivateAtomic(statePath(repositoryRoot), `${merged.map((quad) => quad.canonical).join("\n")}\n`, true);
    return merged;
  });
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
    // The identity of the graph closure the runtime economics derive from.
    economicsClosureDigest: (economics as { sourceGraphDigest?: unknown }).sourceGraphDigest ?? null,
    corpus: Object.freeze({
      quadCount: integrity?.quadCount ?? null,
      subjectCount: integrity?.subjectCount ?? null,
      checkedInvariantCount: Array.isArray(integrity?.checkedCodes) ? integrity.checkedCodes.length : null,
      ownedGraphViolationCount: integrity?.ownedGraphViolationCount ?? null,
      recordedLegacyDebtCount: integrity?.legacyGraphViolationCount ?? null,
      gateConforming: integrity?.gateConforming ?? null,
    }),
  });

  const allDiscovered = await discoverWork(repositoryRoot, parsed.workDirectory);
  const discovered = operation === "run" && parsed.bindingIri !== undefined
    ? await selectCurrentBindingWork(repositoryRoot, allDiscovered, parsed.bindingIri)
    : allDiscovered;
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

  // One dependency graph across every discovered work unit, so a dependency
  // may cross work-graph boundaries and a cycle cannot hide between files.
  const allQuads = discovered.flatMap((work) => [...work.quads]);
  const allUnits = discovered.flatMap((work) => [...work.unitIris]);
  const graphOfUnit = new Map<string, DiscoveredWork>();
  for (const work of discovered) for (const unit of work.unitIris) graphOfUnit.set(unit, work);
  const dependencyGraph = readDependencyGraph(allQuads, allUnits);

  /**
   * Derive one state per unit from the dependency edges and the recorded
   * outcomes. Readiness is never stored: it is recomputed every cycle so it
   * cannot disagree with the outcomes that produce it.
   */
  const deriveSchedule = (): ReadonlyMap<string, WorkUnitState> => {
    const succeeded = completedUnits();
    const failed = new Set(allUnits.filter(
      (unit) => !succeeded.has(unit) && attemptsFor(unit) >= maximumAttemptsPerUnit,
    ));
    return deriveStates(dependencyGraph, { succeeded, failed });
  };

  if (operation === "status") {
    const done = completedUnits();
    const states = deriveSchedule();
    const ready = readyUnits(states);
    return {
      output: Object.freeze({
        schema: "urn:usf:hermes-status:1" as const,
        version: 1 as const,
        authority,
        workGraphs: Object.freeze(discovered.map((work) => Object.freeze({
          file: work.file, graph: work.graph, unitCount: work.unitIris.length,
          completedCount: work.unitIris.filter((unit) => done.has(unit)).length,
        }))),
        dependency: Object.freeze({
          declaredUnitCount: allUnits.length,
          edgeCount: [...dependencyGraph.dependencies.values()].reduce((total, edges) => total + edges.length, 0),
          acyclic: dependencyGraph.acyclic,
          defects: dependencyGraph.defects,
          stateCounts: stateCounts(states),
        }),
        stateQuadCount: state.length,
        completedUnitCount: done.size,
        readyUnitCount: ready.length,
        readyToRun: ready.length > 0,
      }),
      exitCode: dependencyGraph.defects.length > 0 ? exitCodes.DOMAIN_FAILURE : exitCodes.SUCCESS,
    };
  }

  if (dependencyGraph.defects.length > 0) {
    throw new UsfError("HERMES_WORK_DEPENDENCY_INVALID", exitCodes.INVALID_INPUT,
      "The discovered workload's dependency edges are not a valid acyclic graph.",
      { defects: dependencyGraph.defects.slice(0, 8) });
  }

  const cycleDirectory = await secureHermesDirectory(repositoryRoot);

  const cycles: unknown[] = [];
  const changedUnitIris = new Set<string>();
  let terminalState = "idle-no-pending-work";

  for (let cycle = 1; cycle <= parsed.maximumCycles; cycle += 1) {
    const states = deriveSchedule();
    const ready = readyUnits(states);
    const counts = stateCounts(states);
    if (ready.length === 0) {
      // Nothing is dispatchable. Distinguish an empty workload from one whose
      // remaining units can never become ready.
      terminalState = counts.blocked > 0 ? "blocked-no-progress"
        : counts.unreachable > 0 ? "terminal-with-unreachable-work"
        : cycle === 1 ? "idle-no-pending-work"
        : "all-work-terminal";
      break;
    }

    // Every ready unit is dispatched this cycle, grouped by its source work
    // graph. Independent work therefore runs concurrently, and a unit whose
    // dependencies are unsatisfied is simply not in the ready set.
    const byGraph = new Map<string, string[]>();
    for (const unit of ready) {
      const work = graphOfUnit.get(unit);
      if (work === undefined) continue;
      const bucket = byGraph.get(work.graph) ?? [];
      bucket.push(unit);
      byGraph.set(work.graph, bucket);
    }

    let advanced = 0;
    const dispatches: unknown[] = [];
    for (const [graphIri, units] of [...byGraph.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const work = graphOfUnit.get(units[0]!)!;
      const inThisGraph = new Set(work.unitIris);
      // The dispatched graph validates its entire dependency set, so every
      // externally-referenced dependency in that graph must be named, not only
      // those of the selected units.
      const externallySatisfied = Object.freeze([...new Set(work.unitIris
        .flatMap((unit) => dependencyGraph.dependencies.get(unit) ?? [])
        .filter((dependency) => !inThisGraph.has(dependency)))].sort());
      // The whole work graph is supplied so its dependency edges validate; the
      // scheduler names exactly the units it selected.
      const selector = bindingSelector(repositoryRoot, work);
      const boundUnit = selector !== undefined ? work.unitIris[0]! : units[0]!;
      if (selector !== undefined) {
        const observed = await verifyBoundWork(repositoryRoot, work, boundUnit, selector);
        if (observed.status === "SETTLED" || observed.status === "COMPLETED") {
          dispatches.push(Object.freeze({
            workGraph: graphIri,
            dispatchedUnits: Object.freeze([]),
            graphExecutionStatus: "excluded-already-terminal",
            dispatchFailure: null,
            dispatchFailureDetail: null,
            graphExecutionEvidenceDigest: null,
            authoritySnapshot: null,
            concurrency: null,
            transportsUsed: Object.freeze([]),
            refusals: Object.freeze([]),
          }));
          continue;
        }
        if (observed.status === "UNKNOWN") {
          dispatches.push(Object.freeze({
            workGraph: graphIri,
            dispatchedUnits: Object.freeze([]),
            graphExecutionStatus: "refused-unknown-linear-attempt",
            dispatchFailure: "LINEAR_BINDING_ATTEMPT_UNKNOWN",
            dispatchFailureDetail: "UNKNOWN requires bounded reconciliation and is never placed on the generic retry path.",
            graphExecutionEvidenceDigest: null,
            authoritySnapshot: null,
            concurrency: null,
            transportsUsed: Object.freeze([]),
            refusals: Object.freeze([Object.freeze({ unit: boundUnit, attempts: attemptsFor(boundUnit) })]),
          }));
          continue;
        }
        let started;
        try {
          started = await beforeHermesDispatch(selector);
        } catch (error) {
          if (error instanceof LinearBindingError) throw new UsfError(error.reasonCode, exitCodes.DOMAIN_FAILURE, error.reasonCode);
          throw error;
        }
        if (started.status !== "STARTED") {
          throw new UsfError("HERMES_LINEAR_BINDING_NOT_STARTED", exitCodes.DOMAIN_FAILURE, "Bound work may dispatch only from a freshly established STARTED attempt.");
        }
        await verifyBoundWork(repositoryRoot, work, boundUnit, selector);
      }
      const executed = await graphExecuteCommand(repositoryRoot, [
        "--input", work.file,
        "--graph", graphIri,
        "--env-file", parsed.envFile,
        "--concurrency", String(parsed.concurrency),
        "--only", [...units].sort().join(","),
        // Dependencies satisfied in another work graph are named explicitly so
        // the dispatched graph can validate its edges without assuming them.
        ...(externallySatisfied.length > 0 ? ["--satisfied-dependency", externallySatisfied.join(",")] : []),
      ]).catch((error: unknown) => ({
        output: Object.freeze({
          status: "refused",
          // A dispatch that could not even be attempted is reported, not hidden.
          failure: error instanceof Error ? error.message.slice(0, 300) : "unknown",
          reasonCode: (error as { code?: unknown }).code ?? null,
          details: (error as { details?: unknown }).details ?? null,
        }),
        exitCode: exitCodes.EXTERNAL_UNAVAILABLE as ExitCode,
      }));
      const evidence = executed.output as Record<string, unknown>;
      let unitRecords = Array.isArray(evidence.units) ? evidence.units as Record<string, unknown>[] : [];
      if (selector !== undefined) {
        const successful = unitRecords.length === 1
          && unitRecords[0]!.unit === boundUnit
          && unitRecords[0]!.status === "ok";
        const refused = evidence.status === "refused"
          && unitRecords.length === 1
          && unitRecords[0]!.unit === boundUnit
          && unitRecords[0]!.status === "refused";
        const evidenceDigest = evidence.evidenceDigest;
        if ((!successful && !refused) || typeof evidenceDigest !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(evidenceDigest)) {
          unitRecords = [];
        } else if (refused) {
          try {
            const retryable = await afterHermesRefusal(selector, evidenceDigest as `sha256:${string}`);
            if (retryable.status !== "REFUSED") unitRecords = [];
          } catch (error) {
            if (!(error instanceof LinearBindingError)) throw error;
            unitRecords = [];
          }
        } else {
          try {
            const settled = await afterHermesResult(selector, evidenceDigest as `sha256:${string}`);
            if (settled.status !== "SETTLED" && settled.status !== "COMPLETED") {
              unitRecords = [];
            }
          } catch (error) {
            if (!(error instanceof LinearBindingError)) throw error;
            unitRecords = [];
          }
        }
      }

      for (const unitRecord of unitRecords) {
        const unitIri = typeof unitRecord.unit === "string" ? unitRecord.unit : null;
        if (unitIri === null) continue;
        const attempts = attemptsFor(unitIri) + 1;
        changedUnitIris.add(unitIri);
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
        for (const dependency of dependencyGraph.dependencies.get(unitIri) ?? []) {
          state.push(quadOf(resultIri, "urn:usf:predicate:satisfiedDependency", dependency, "iri"));
        }
        state.push(quadOf(resultIri, "urn:usf:predicate:hermesCycle", String(cycle), "literal"));
        advanced += 1;
      }

      dispatches.push(Object.freeze({
        workGraph: graphIri,
        dispatchedUnits: Object.freeze([...units].sort()),
        graphExecutionStatus: evidence.status ?? "unknown",
        dispatchFailure: evidence.reasonCode ?? null,
        dispatchFailureDetail: evidence.details ?? null,
        graphExecutionEvidenceDigest: evidence.evidenceDigest ?? null,
        authoritySnapshot: evidence.authoritySnapshot ?? null,
        concurrency: evidence.concurrency ?? null,
        transportsUsed: Object.freeze([...new Set(unitRecords
          .filter((unit) => unit.status === "ok" && typeof unit.transport === "string")
          .map((unit) => unit.transport as string))].sort()),
        refusals: Object.freeze(unitRecords
          .filter((unit) => unit.status !== "ok")
          .map((unit) => Object.freeze({ unit: unit.unit, attempts: unit.attempts }))),
      }));
    }

    cycles.push(Object.freeze({
      cycle,
      // The schedule Hermes derived, before dispatch, from dependencies alone.
      derivedStateCounts: counts,
      readyUnits: Object.freeze([...ready]),
      dispatchCount: dispatches.length,
      dispatches: Object.freeze(dispatches),
      advancedUnitCount: advanced,
    }));

    if (advanced === 0) {
      terminalState = "blocked-no-progress";
      break;
    }
    const nextReady = readyUnits(deriveSchedule());
    terminalState = nextReady.length === 0 ? "all-work-terminal" : "cycles-exhausted";
  }

  // Read and merge inside the narrow persistence queue. Provider dispatch has
  // already completed, so this does not reduce graph/provider concurrency.
  state = [...await persistMergedState(repositoryRoot, state, [...changedUnitIris])];
  const orderedState = canonicalState(state);

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
    totalUnitCount: allUnits.length,
    dependency: Object.freeze({
      declaredUnitCount: allUnits.length,
      edgeCount: [...dependencyGraph.dependencies.values()].reduce((total, edges) => total + edges.length, 0),
      acyclic: dependencyGraph.acyclic,
      finalStateCounts: stateCounts(deriveSchedule()),
    }),
    nonClaims: Object.freeze([
      "Readiness is derived from dependency edges and recorded outcomes on every cycle; it is never stored, so it cannot disagree with the outcomes that produce it.",
      "Hermes selected no provider or model itself. Each route was derived from the catalogue classification, transport capability and economic policy in force at dispatch time.",
      "A refused unit is re-queued for a later cycle up to a bounded attempt count; exhausting that bound is recorded, never retried indefinitely.",
      "The state graph records what executed. It asserts no construction, completion, publication or Git authority.",
    ]),
  });

  const reportBytes = `${JSON.stringify(report, null, 1)}\n`;
  await writePrivateAtomic(
    resolve(cycleDirectory, `cycle-report-${canonicalDigest(report).slice("sha256:".length)}.json`),
    reportBytes,
    false,
  );

  return {
    output: report,
    exitCode: (terminalState === "all-work-terminal" || terminalState === "idle-no-pending-work"
      ? exitCodes.SUCCESS
      : terminalState === "blocked-no-progress" ? exitCodes.EXTERNAL_UNAVAILABLE
      : terminalState === "terminal-with-unreachable-work" ? exitCodes.CONTINUOUS_DEGRADED
      : exitCodes.CONTINUOUS_DEGRADED) as ExitCode,
  };
}
