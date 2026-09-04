import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { canonicalDigest } from "../core/canonical.ts";
import { confinedNodeTestLaunch } from "../commands/check.ts";
import type { SemanticGraph } from "../graph/index.ts";
import type { CorpusObservationEntry } from "./facet-evaluation.ts";
import { parseSpecOutcomes, runChild } from "./implementation-conformance.ts";

/**
 * Structural evidence for corpus-scoped architecture requirements.
 *
 * An architecture property is a property of a corpus, not a behaviour of any
 * one module. "No dependency cycle exists" cannot be observed by calling an
 * export and asserting on what came back, because no export knows about the
 * other modules. Asking a per-capability conformance test for it produces
 * either no subtest at all or one that asserts a constant, and both are
 * refused -- correctly -- by the rule that stops an implementation authoring
 * its own evidence.
 *
 * So the observation is made at the scope the requirement is stated at. A
 * procedure the corpus declares runs over the whole corpus and reports one
 * outcome per requirement it is able to decide. The vehicle is the same
 * confined node test every other check in this repository executes through,
 * because that confinement is what makes an executed result trustworthy; what
 * differs is the scope it observes and the evidence class it produces.
 *
 * This module writes no verdict. It records what the procedure returned, and
 * the facet evaluator alone decides what that means.
 */

const observationTimeoutMs = 300_000;

export const corpusObservationDirectory = ".usf/architecture-observations";

export interface CorpusFacetObservation {
  readonly facet: string;
  readonly facetName: string;
  /** The procedure declared an outcome for this requirement. */
  readonly executed: boolean;
  readonly passed: boolean;
  readonly detail: string | null;
}

export interface CorpusArchitectureObservation {
  readonly schema: "urn:usf:corpus-architecture-observation:1";
  readonly version: 1;
  /** The declared procedure that produced this, never the tool it happens to use. */
  readonly procedure: string;
  /** The repository the observed corpus belongs to, or null when USF observes itself. */
  readonly sourceRepository: string | null;
  readonly observationPath: string;
  readonly observationPathDigest: string;
  /** The declared roots the corpus is enumerated from, in declaration order. */
  readonly corpusRoots: readonly string[];
  /**
   * Binds the record to the exact corpus it observed. A structural claim is
   * about a body of code, so it stops being true the moment that body changes;
   * without this a passing observation would outlive the corpus that earned it.
   */
  readonly corpusDigest: string;
  readonly corpusFileCount: number;
  readonly confined: boolean;
  readonly command: readonly string[];
  readonly executed: boolean;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly reportedPassCount: number;
  readonly reportedFailCount: number;
  readonly outcomes: readonly CorpusFacetObservation[];
  readonly refusal: string | null;
  readonly nonClaims: readonly string[];
}

export type { CorpusObservationEntry };

/** One requirement the procedure is declared to decide. */
export interface ObservableRequirement {
  readonly facet: string;
  readonly canonicalName: string;
}

/** A corpus observation procedure exactly as the graph declares it. */
export interface CorpusObservationProcedure {
  readonly procedure: string;
  readonly sourceRepository: string | null;
  readonly observationPath: string;
  readonly corpusRoots: readonly string[];
  readonly requirements: readonly ObservableRequirement[];
}

const sourceExtension = /\.(?:ts|tsx|mts|cts|js|mjs|cjs|jsx)$/u;

/**
 * Digest the declared corpus. Only the roots the procedure names are walked,
 * so a change anywhere the requirement does not reach leaves the observation
 * standing -- and a change inside it retires the observation immediately.
 */
export async function digestCorpus(
  sourceRoot: string,
  corpusRoots: readonly string[],
): Promise<Readonly<{ digest: string; fileCount: number }>> {
  const members: string[] = [];
  const walk = async (relativePath: string): Promise<void> => {
    const absolute = resolve(sourceRoot, relativePath);
    const entries = await readdir(absolute, { withFileTypes: true }).catch(() => []);
    for (const entry of [...entries].sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const child = `${relativePath}/${entry.name}`;
      if (entry.isDirectory()) { await walk(child); continue; }
      if (!entry.isFile() || !sourceExtension.test(entry.name)) continue;
      const bytes = await readFile(resolve(sourceRoot, child), "utf8").catch(() => undefined);
      if (bytes === undefined) continue;
      members.push(`${child}@${canonicalDigest(bytes)}`);
    }
  };
  for (const root of [...corpusRoots].sort()) await walk(root);
  members.sort();
  return Object.freeze({ digest: canonicalDigest(members.join("\n")), fileCount: members.length });
}

/**
 * Execute one declared corpus observation procedure and record what it
 * returned. Every failure mode produces a record rather than an exception: a
 * procedure that could not run is a different fact from one that ran and found
 * nothing wrong, and only the first should ever be repairable.
 */
export async function runCorpusObservation(
  repositoryRoot: string,
  declared: CorpusObservationProcedure,
  sourceRoot: string,
): Promise<CorpusArchitectureObservation> {
  const observationBytes = await readFile(resolve(sourceRoot, declared.observationPath), "utf8").catch(() => undefined);
  const corpus = await digestCorpus(sourceRoot, declared.corpusRoots);
  const base = {
    schema: "urn:usf:corpus-architecture-observation:1" as const,
    version: 1 as const,
    procedure: declared.procedure,
    sourceRepository: declared.sourceRepository,
    observationPath: declared.observationPath,
    observationPathDigest: observationBytes === undefined ? "" : canonicalDigest(observationBytes),
    corpusRoots: Object.freeze([...declared.corpusRoots]),
    corpusDigest: corpus.digest,
    corpusFileCount: corpus.fileCount,
    reportedPassCount: 0,
    reportedFailCount: 0,
    nonClaims: Object.freeze([
      "This record states that a declared procedure ran over a named corpus inside the repository confinement and what it returned for each requirement it was asked to decide. It records no satisfaction.",
      "A requirement the procedure returned no outcome for is undecided by this procedure. That is not a claim that the corpus satisfies it.",
      "The corpus digest binds this observation to the exact source it observed. It says nothing about any other corpus or any later state of this one.",
    ]),
  };
  const refused = (reason: string): CorpusArchitectureObservation => Object.freeze({
    ...base, confined: false, command: Object.freeze([]), executed: false, exitCode: null, signal: null,
    outcomes: Object.freeze([]), refusal: reason,
  });

  if (observationBytes === undefined) {
    return refused(`the declared observation procedure names ${declared.observationPath}, which does not exist in the observed repository`);
  }
  const scratch = resolve(sourceRoot, ".usf", "hermes", "observation-scratch");
  await rm(scratch, { recursive: true, force: true });
  await mkdir(scratch, { recursive: true, mode: 0o700 });
  const command = Object.freeze(["node", "--test", "--test-isolation=none", declared.observationPath]);
  const launch = confinedNodeTestLaunch(
    sourceRoot, scratch,
    [resolve(repositoryRoot, "node_modules"), resolve(repositoryRoot, ".usf", "cache")],
    command,
  );
  if (launch === null) {
    await rm(scratch, { recursive: true, force: true });
    return refused("the repository confinement is unavailable, so the procedure was not executed");
  }
  const result = await runChild(launch.executable, launch.arguments, sourceRoot, observationTimeoutMs);
  await rm(scratch, { recursive: true, force: true });
  if (!result.launched) {
    return Object.freeze({ ...refused("the confined observation process could not be launched"), confined: true });
  }
  const parsed = parseSpecOutcomes(result.output);
  return Object.freeze({
    ...base,
    confined: true,
    command,
    executed: true,
    exitCode: result.code,
    signal: result.signal,
    reportedPassCount: parsed.passCount,
    reportedFailCount: parsed.failCount,
    outcomes: Object.freeze(declared.requirements.map((requirement) => {
      const name = requirement.canonicalName;
      if (parsed.failed.has(name)) {
        return Object.freeze({
          facet: requirement.facet, facetName: name, executed: true, passed: false,
          detail: parsed.details.get(name)
            ?? `the declared procedure ran over the corpus and reported this requirement violated`,
        });
      }
      if (parsed.passed.has(name)) {
        return Object.freeze({ facet: requirement.facet, facetName: name, executed: true, passed: true, detail: null });
      }
      // Undecided is not satisfied and not violated. A procedure that cannot
      // reach a requirement leaves it exactly where it was, and saying so is
      // the whole difference between missing evidence and a passing corpus.
      return Object.freeze({
        facet: requirement.facet, facetName: name, executed: false, passed: false,
        detail: `the declared procedure ran but returned no outcome named for this requirement, so it does not decide it`,
      });
    })),
    refusal: null,
  });
}

function recordName(observation: CorpusArchitectureObservation): string {
  return `${canonicalDigest(`${observation.procedure} ${observation.sourceRepository ?? ""}`).slice(7)}.json`;
}

export async function recordCorpusObservation(
  repositoryRoot: string,
  observation: CorpusArchitectureObservation,
): Promise<string> {
  const directory = resolve(repositoryRoot, corpusObservationDirectory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = resolve(directory, recordName(observation));
  await writeFile(path, `${JSON.stringify(observation, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return path;
}

/**
 * Read every recorded corpus observation back, keyed by the requirement it
 * decided.
 *
 * Admission is deliberately strict, and deliberately the same shape as
 * behavioural evidence: only a confined, executed procedure whose recorded
 * corpus digest still equals the corpus as it stands now may satisfy anything.
 * A record that no longer binds the current corpus is kept and marked stale,
 * because "this was true of a corpus that has since changed" is a different
 * fact from "this was never observed".
 */
export async function loadCorpusObservations(
  repositoryRoot: string,
  sourceRootFor: (repository: string | null) => string = () => repositoryRoot,
): Promise<ReadonlyMap<string, CorpusObservationEntry>> {
  const directory = resolve(repositoryRoot, corpusObservationDirectory);
  const names = (await readdir(directory).catch(() => [] as string[])).filter((name) => name.endsWith(".json")).sort();
  const entries = new Map<string, CorpusObservationEntry>();
  for (const name of names) {
    const bytes = await readFile(resolve(directory, name), "utf8").catch(() => undefined);
    if (bytes === undefined) continue;
    let record: CorpusArchitectureObservation;
    try { record = JSON.parse(bytes) as CorpusArchitectureObservation; } catch { continue; }
    if (record.schema !== "urn:usf:corpus-architecture-observation:1") continue;
    if (!Array.isArray(record.outcomes) || typeof record.procedure !== "string") continue;
    const sourceRoot = sourceRootFor(record.sourceRepository ?? null);
    const observationBytes = await readFile(resolve(sourceRoot, record.observationPath), "utf8").catch(() => undefined);
    const currentCorpus = await digestCorpus(sourceRoot, record.corpusRoots ?? []);
    const stale = currentCorpus.digest !== record.corpusDigest
      || observationBytes === undefined
      || canonicalDigest(observationBytes) !== record.observationPathDigest;
    const usable = record.executed === true && record.confined === true && record.refusal === null;
    for (const outcome of record.outcomes) {
      if (typeof outcome.facet !== "string") continue;
      // Later records win only when they are usable. An unusable rerun must not
      // erase the standing observation it failed to reproduce, and a usable one
      // must always replace whatever came before it.
      const existing = entries.get(outcome.facet);
      if (existing !== undefined && !usable) continue;
      entries.set(outcome.facet, Object.freeze({
        facet: outcome.facet,
        procedure: record.procedure,
        executed: usable && outcome.executed === true,
        passed: usable && outcome.executed === true && outcome.passed === true,
        stale,
        detail: usable
          ? outcome.detail ?? null
          : record.refusal ?? "the declared procedure did not execute under confinement, so it observed nothing",
        evidence: `${record.procedure}@${record.corpusDigest.slice(7, 26)}`,
      }));
    }
  }
  return entries;
}

/**
 * Recover every corpus observation procedure the selected graph declares.
 *
 * Nothing here knows the name of any requirement. A procedure states the
 * corpus it observes and each requirement binds itself to the procedure that
 * decides it, so adding a requirement or retiring one is a graph edit and the
 * planner, the runner and the evaluator all follow without a code change.
 */
export function declaredCorpusProcedures(graph: SemanticGraph): readonly CorpusObservationProcedure[] {
  const P = "urn:usf:predicate:";
  const one = (subject: string, predicate: string): string | null =>
    graph.quads.find((quad) => quad.subject === subject && quad.predicate === `${P}${predicate}`)?.object ?? null;
  const many = (subject: string, predicate: string): readonly string[] =>
    graph.quads.filter((quad) => quad.subject === subject && quad.predicate === `${P}${predicate}`)
      .map((quad) => quad.object).sort();
  const procedures = graph.quads
    .filter((quad) => quad.predicate === `${P}type` && quad.object === "urn:usf:type:CorpusObservationProcedure")
    .map((quad) => quad.subject).sort();
  return Object.freeze(procedures.flatMap((procedure) => {
    const observationPath = one(procedure, "observationPath");
    const corpusRoots = many(procedure, "corpusRoot");
    if (observationPath === null || corpusRoots.length === 0) return [];
    const requirements = graph.quads
      .filter((quad) => quad.predicate === `${P}observedByProcedure` && quad.object === procedure)
      .map((quad) => quad.subject)
      .sort()
      .flatMap((facet) => {
        const canonicalName = one(facet, "canonicalName");
        // A requirement that names no subtest cannot be looked up in what the
        // procedure returned, so it is not something this procedure decides.
        return canonicalName === null ? [] : [Object.freeze({ facet, canonicalName })];
      });
    if (requirements.length === 0) return [];
    return [Object.freeze({
      procedure,
      sourceRepository: one(procedure, "observesRepository"),
      observationPath,
      corpusRoots,
      requirements: Object.freeze(requirements),
    })];
  }));
}
