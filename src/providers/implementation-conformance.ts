import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { canonicalDigest } from "../core/canonical.ts";
import { confinedNodeTestLaunch } from "../commands/check.ts";
import type { ConformanceEvidenceEntry } from "./facet-evaluation.ts";
import { classifySubtests, type CapabilityImplementationNeed } from "./implementation-work.ts";

/**
 * Behavioural evidence for implementation-conformance requirements.
 *
 * A file containing an audit function is not evidence that audit failure
 * prevents a mutation. This module executes the capability's conformance test
 * against the real module inside the repository's existing confinement -- no
 * network, no writable filesystem outside a scratch root, no ambient
 * environment -- and records what each facet-named subtest returned. It records
 * outcomes only; turning an outcome into a verdict remains the evaluator's job.
 */
const conformanceTimeoutMs = 120_000;
const typecheckTimeoutMs = 180_000;
const maximumCapturedBytes = 16_000;

export interface FacetConformanceOutcome {
  readonly facet: string;
  readonly facetName: string;
  readonly executed: boolean;
  readonly passed: boolean;
  /** The subtest exercises the module rather than asserting its shape. */
  readonly admissible: boolean;
  readonly detail: string | null;
}

/**
 * What a run established. Distinguishing these matters: a module that compiles
 * while its test has simply not been written yet is progress, and treating it
 * as a defect deadlocks the capability -- the conformance unit is withheld
 * because the capability "fails", and the failure is that no conformance test
 * exists.
 */
export type ConformanceOutcomeClass = "observed" | "awaiting-test" | "blocked";

export interface ConformanceRun {
  readonly schema: "urn:usf:implementation-conformance-evidence:1";
  readonly version: 1;
  readonly outcomeClass: ConformanceOutcomeClass;
  readonly capability: string;
  /**
   * The product repository the observed paths are relative to, or null for USF
   * itself. Without it a reader cannot know which root to resolve them against,
   * and resolving a product's paths under USF makes every product observation
   * permanently stale.
   */
  readonly sourceRepository: string | null;
  readonly modulePath: string;
  readonly modulePathDigest: string;
  readonly conformancePath: string;
  readonly conformancePathDigest: string;
  readonly confined: boolean;
  readonly command: readonly string[];
  readonly executed: boolean;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly typecheck: Readonly<{ ran: boolean; clean: boolean; detail: string | null }>;
  readonly reportedPassCount: number;
  readonly reportedFailCount: number;
  readonly outcomes: readonly FacetConformanceOutcome[];
  readonly refusal: string | null;
  readonly authoritySnapshot: string;
  readonly nonClaims: readonly string[];
}

interface ChildResult {
  readonly code: number | null;
  readonly signal: string | null;
  readonly output: string;
  readonly launched: boolean;
}

async function runChild(
  executable: string,
  args: readonly string[],
  cwd: string,
  timeoutMs: number,
): Promise<ChildResult> {
  return new Promise<ChildResult>((complete) => {
    let output = "";
    let settled = false;
    const child = spawn(executable, [...args], {
      cwd, env: { LANG: "C.UTF-8", LC_ALL: "C.UTF-8", NO_COLOR: "1", PATH: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const capture = (chunk: Buffer): void => {
      if (output.length < maximumCapturedBytes) output = `${output}${chunk.toString("utf8")}`.slice(0, maximumCapturedBytes);
    };
    const finish = (code: number | null, signal: string | null, launched: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      complete(Object.freeze({ code, signal, output, launched }));
    };
    const timer = setTimeout(() => { child.kill("SIGKILL"); finish(null, "SIGKILL", true); }, timeoutMs);
    child.stdout?.on("data", capture);
    child.stderr?.on("data", capture);
    child.on("error", () => finish(null, null, false));
    child.on("close", (code, signal) => finish(code, signal, true));
  });
}

/** Names the Node spec reporter prints for passing and failing tests. */
export function parseSpecOutcomes(output: string): Readonly<{
  passed: ReadonlySet<string>; failed: ReadonlySet<string>; passCount: number; failCount: number;
}> {
  const passed = new Set<string>();
  const failed = new Set<string>();
  let passCount = 0;
  let failCount = 0;
  for (const line of output.split("\n")) {
    const pass = /^✔ (.+?) \(\d/u.exec(line);
    if (pass !== null) { passed.add(pass[1]!); continue; }
    const fail = /^✖ (.+?) \(\d/u.exec(line);
    if (fail !== null) { failed.add(fail[1]!); continue; }
    const counts = /^.?\s*(pass|fail) (\d+)$/u.exec(line.trim());
    if (counts !== null) {
      if (counts[1] === "pass") passCount = Number(counts[2]);
      else failCount = Number(counts[2]);
    }
  }
  // A name that failed is not also a pass, whatever order the reporter used.
  for (const name of failed) passed.delete(name);
  return Object.freeze({ passed, failed, passCount, failCount });
}

/**
 * Typecheck exactly the two files under the repository's compiler settings.
 * This reads the sources; it never executes them, so it needs no confinement.
 */
async function typecheck(
  repositoryRoot: string,
  paths: readonly string[],
  sourceRoot: string = repositoryRoot,
): Promise<Readonly<{ ran: boolean; clean: boolean; detail: string | null }>> {
  // The compiler is USF's, because USF owns the toolchain. The paths are the
  // source repository's, because that is where the code being compiled lives.
  // A product realisation therefore needs no toolchain of its own, which is
  // what lets a product repository stay a plain checkout.
  const compiler = resolve(repositoryRoot, "node_modules", "typescript", "bin", "tsc");
  if (await stat(compiler).then(() => false, () => true)) {
    return Object.freeze({ ran: false, clean: false, detail: "the TypeScript compiler is not installed" });
  }
  const result = await runChild(process.execPath, [
    compiler, "--noEmit", "--strict", "--skipLibCheck",
    "--target", "es2024", "--module", "nodenext", "--moduleResolution", "nodenext",
    "--allowImportingTsExtensions", "--types", "node",
    // Absolute, because the compiler runs from the USF root so that its own
    // installed type definitions resolve, while the files it compiles live in
    // whichever repository owns the realisation.
    ...paths.map((path) => resolve(sourceRoot, path)),
  ], repositoryRoot, typecheckTimeoutMs);
  if (!result.launched) return Object.freeze({ ran: false, clean: false, detail: "the compiler could not be launched" });
  return Object.freeze({
    ran: true,
    clean: result.code === 0,
    detail: result.code === 0 ? null : result.output.slice(0, 2_000),
  });
}

/**
 * Execute one capability's conformance test and record the per-facet outcome.
 * Every refusal path returns a record: an unexecuted check is a fact worth
 * keeping, and it must never be mistaken for a passing one.
 */
export async function runCapabilityConformance(
  repositoryRoot: string,
  need: CapabilityImplementationNeed,
  authoritySnapshot: string,
  /** The product repository owning the source, or null when USF owns it. */
  sourceRepository: string | null = null,
  /**
   * Where the capability source lives. USF realises its own capabilities into
   * itself, so this defaults to the USF root; a product profile realises into
   * its own repository, and its evidence must be executed against that source
   * rather than against USF. Satisfaction of a product requirement can then
   * only ever be derived from that product's own evidence.
   */
  sourceRoot: string = repositoryRoot,
): Promise<ConformanceRun> {
  const moduleBytes = await readFile(resolve(sourceRoot, need.modulePath), "utf8").catch(() => undefined);
  const testBytes = await readFile(resolve(sourceRoot, need.conformancePath), "utf8").catch(() => undefined);
  const base = {
    schema: "urn:usf:implementation-conformance-evidence:1" as const,
    version: 1 as const,
    capability: need.capability,
    sourceRepository,
    modulePath: need.modulePath,
    modulePathDigest: moduleBytes === undefined ? "" : canonicalDigest(moduleBytes),
    conformancePath: need.conformancePath,
    conformancePathDigest: testBytes === undefined ? "" : canonicalDigest(testBytes),
    authoritySnapshot,
    nonClaims: Object.freeze([
      "This record states that a named behavioural test executed against the capability module inside the repository confinement and what each facet-named subtest returned. It records no satisfaction.",
      "A passing subtest is evidence of observed module behaviour under test. It is not evidence of deployed product behaviour, integration behaviour or runtime composition.",
      "The test does not claim to be a complete characterization of the requirement it is named for.",
    ]),
  };
  const refused = (refusal: string, outcomeClass: ConformanceOutcomeClass = "blocked"): ConformanceRun => Object.freeze({
    ...base, outcomeClass, confined: false, command: Object.freeze([]), executed: false, exitCode: null, signal: null,
    typecheck: Object.freeze({ ran: false, clean: false, detail: null }),
    reportedPassCount: 0, reportedFailCount: 0,
    outcomes: Object.freeze(need.requirements.map((requirement) => Object.freeze({
      facet: requirement.facet, facetName: requirement.canonicalName, executed: false, passed: false,
      admissible: true, detail: refusal,
    }))),
    refusal,
  });

  if (moduleBytes === undefined) return refused("the implementation module does not exist");

  // The module is compiled on its own as soon as it exists. A module that does
  // not compile is a fact worth recording before a test is ever written against
  // it: writing one would spend a dispatch describing code that cannot run.
  const moduleOnly = await typecheck(repositoryRoot, [need.modulePath], sourceRoot);
  if (!moduleOnly.clean) {
    return Object.freeze({
      ...refused("the implementation module does not typecheck, so no behaviour can be observed"),
      typecheck: moduleOnly,
    });
  }
  if (testBytes === undefined) {
    return Object.freeze({
      ...refused("the module compiles; its conformance test has not been written yet", "awaiting-test"),
      typecheck: moduleOnly,
    });
  }

  const compiled = await typecheck(repositoryRoot, [need.modulePath, need.conformancePath], sourceRoot);
  if (!compiled.clean) {
    return Object.freeze({
      ...refused("the implementation does not typecheck, so no behaviour can be observed"),
      typecheck: compiled,
    });
  }

  const scratch = resolve(sourceRoot, ".usf", "hermes", "conformance-scratch");
  await rm(scratch, { recursive: true, force: true });
  await mkdir(scratch, { recursive: true, mode: 0o700 });
  const command = Object.freeze(["node", "--test", "--test-isolation=none", need.conformancePath]);
  const launch = confinedNodeTestLaunch(
    sourceRoot, scratch,
    [resolve(repositoryRoot, "node_modules"), resolve(repositoryRoot, ".usf", "cache")],
    command,
  );
  if (launch === null) {
    return Object.freeze({ ...refused("the repository confinement is unavailable, so the test was not executed"), typecheck: compiled });
  }
  const result = await runChild(launch.executable, launch.arguments, sourceRoot, conformanceTimeoutMs);
  await rm(scratch, { recursive: true, force: true });
  if (!result.launched) {
    return Object.freeze({ ...refused("the confined test process could not be launched"), typecheck: compiled, confined: true });
  }
  const parsed = parseSpecOutcomes(result.output);
  const subtests = classifySubtests(testBytes, need.requirements.map((entry) => entry.canonicalName));
  return Object.freeze({
    ...base,
    outcomeClass: "observed" as const,
    confined: true,
    command,
    executed: true,
    exitCode: result.code,
    signal: result.signal,
    typecheck: compiled,
    reportedPassCount: parsed.passCount,
    reportedFailCount: parsed.failCount,
    outcomes: Object.freeze(need.requirements.map((requirement) => {
      const name = requirement.canonicalName;
      // A subtest that never calls the module proves nothing about behaviour,
      // whatever the runner reported for it.
      if (subtests.named.has(name) && !subtests.invoking.has(name)) {
        return Object.freeze({
          facet: requirement.facet, facetName: name, executed: false, passed: false, admissible: false,
          detail: `the subtest for this requirement in ${need.conformancePath} asserts exported shape without invoking the module, so it observes no behaviour`,
        });
      }
      // Attribution is by containment, because a reporter name may carry
      // decoration the model added. A canonical facet name is long and unique,
      // so a name matching two requirements is refused rather than guessed.
      const attributed = (names: ReadonlySet<string>): boolean => {
        const hits = [...names].filter((entry) => entry.includes(name));
        return hits.length > 0 && hits.every((entry) =>
          need.requirements.filter((other) => entry.includes(other.canonicalName)).length === 1);
      };
      const failed = attributed(parsed.failed);
      const passed = !failed && attributed(parsed.passed);
      return Object.freeze({
        facet: requirement.facet,
        facetName: name,
        executed: passed || failed,
        passed,
        admissible: true,
        detail: passed ? null
          : failed ? "the subtest for this requirement executed and failed"
          : "the conformance test declares no subtest named for this requirement, so nothing was observed",
      });
    })),
    refusal: null,
  });
}

/** Relative repository path form the launcher requires. */
export function repositoryRelative(repositoryRoot: string, path: string): string {
  return relative(repositoryRoot, resolve(repositoryRoot, path));
}

export const conformanceEvidenceDirectory = ".usf/conformance-evidence";

/**
 * Facets whose subtest exists in the current test file but never calls the
 * module. Derived from the file rather than the record so the rule reaches
 * evidence written before it.
 */
async function inadmissibleFacetsOf(
  sourceRoot: string,
  record: ConformanceRun,
): Promise<ReadonlySet<string>> {
  const outcomes = record.outcomes ?? [];
  if (outcomes.length === 0) return new Set();
  const bytes = await readFile(resolve(sourceRoot, record.conformancePath), "utf8").catch(() => undefined);
  if (bytes === undefined) return new Set();
  const subtests = classifySubtests(bytes, outcomes.map((outcome) => outcome.facetName));
  return new Set(outcomes
    .filter((outcome) => subtests.named.has(outcome.facetName) && !subtests.invoking.has(outcome.facetName))
    .map((outcome) => outcome.facet));
}

/**
 * Compile one proposed module body without landing it.
 *
 * A capability module imports only Node builtins, so compiling the candidate in
 * a scratch directory is equivalent to compiling it in place. This exists so a
 * repair that fixes one requirement cannot land a module that breaks the others.
 */
export async function typecheckCandidateModule(
  repositoryRoot: string,
  content: string,
): Promise<Readonly<{ clean: boolean; detail: string | null }>> {
  const directory = resolve(repositoryRoot, ".usf", "hermes", "candidate");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const name = `${canonicalDigest(content).slice("sha256:".length, 24)}.ts`;
  const path = resolve(directory, name);
  try {
    await writeFile(path, content, { mode: 0o600 });
    const result = await typecheck(repositoryRoot, [`.usf/hermes/candidate/${name}`]);
    return Object.freeze({ clean: result.clean, detail: result.detail });
  } finally {
    await rm(path, { force: true });
  }
}

/**
 * Load every recorded conformance run and reduce it to one entry per facet.
 *
 * Admission is deliberately strict: only a confined, typechecked, executed run
 * whose recorded module and test digests still equal the current bytes may
 * satisfy a requirement. A run that no longer binds the current code is kept
 * and marked stale rather than discarded, because "this was true of code that
 * has since changed" is a different fact from "this was never observed".
 */
export async function loadConformanceEvidence(
  repositoryRoot: string,
  /**
   * Where a record's paths resolve, given the repository that produced it.
   *
   * Core and product observations share one directory and are relative to
   * different roots. Resolving them all under USF made every product record
   * permanently stale: the file simply was not there, so its digest read null
   * and never matched. A record that names no repository predates this and is
   * USF's, which is what the default preserves.
   */
  sourceRootFor: (repository: string | null) => string = () => repositoryRoot,
): Promise<ReadonlyMap<string, ConformanceEvidenceEntry>> {
  const directory = resolve(repositoryRoot, conformanceEvidenceDirectory);
  const names = (await readdir(directory).catch(() => [] as string[])).filter((name) => name.endsWith(".json")).sort();
  const currentDigest = new Map<string, string | null>();
  const digestOf = async (root: string, path: string): Promise<string | null> => {
    const key = `${root}\u0000${path}`;
    if (currentDigest.has(key)) return currentDigest.get(key)!;
    const bytes = await readFile(resolve(root, path), "utf8").catch(() => undefined);
    const digest = bytes === undefined ? null : canonicalDigest(bytes);
    currentDigest.set(key, digest);
    return digest;
  };
  const entries = new Map<string, ConformanceEvidenceEntry>();
  for (const name of names) {
    const bytes = await readFile(resolve(directory, name), "utf8").catch(() => undefined);
    if (bytes === undefined) continue;
    let record: ConformanceRun;
    try { record = JSON.parse(bytes) as ConformanceRun; } catch { continue; }
    if (record.schema !== "urn:usf:implementation-conformance-evidence:1") continue;
    // A module-only observation binds no test. It stops describing the current
    // repository the moment either the module changes or a test appears.
    const sourceRoot = sourceRootFor(record.sourceRepository ?? null);
    const currentTest = await digestOf(sourceRoot, record.conformancePath);
    // Admissibility is evaluated against the test as it stands now, not against
    // whatever the rule was when the record was written. A record produced
    // before this rule existed carries no admissible flag, and re-deriving it
    // here applies the rule to every landed test immediately rather than
    // waiting for bytes to change and trigger a re-check that may never come.
    const currentInadmissible = await inadmissibleFacetsOf(sourceRoot, record);
    const moduleOnly = record.conformancePathDigest.length === 0;
    const stale = await digestOf(sourceRoot, record.modulePath) !== record.modulePathDigest
      || (moduleOnly ? currentTest !== null : currentTest !== record.conformancePathDigest);
    // A run that could not execute is retained as a blocked observation. It
    // satisfies nothing, but it is the difference between "this capability is
    // waiting for work" and "this capability is silently stuck". A module that
    // compiles while its test is merely unwritten is neither.
    const blocked = record.outcomeClass === undefined
      ? !record.executed || !record.confined || record.typecheck.clean !== true
      : record.outcomeClass === "blocked";
    if (blocked && record.modulePathDigest.length === 0) continue;
    for (const outcome of record.outcomes ?? []) {
      if (typeof outcome.facet !== "string") continue;
      // A subtest that observes no behaviour is work outstanding, not silence.
      const inadmissible = outcome.admissible === false || currentInadmissible.has(outcome.facet);
      if (!blocked && !inadmissible && !outcome.executed) continue;
      const candidate: ConformanceEvidenceEntry = Object.freeze({
        executed: !blocked && !inadmissible,
        passed: !blocked && !inadmissible && outcome.passed === true,
        stale, blocked: blocked || inadmissible,
        evidence: `${record.conformancePath}@${record.conformancePathDigest.slice(0, 19)} subtest ${outcome.facetName}`,
        detail: inadmissible
          ? outcome.detail ?? `the subtest for this requirement in ${record.conformancePath} asserts exported shape without invoking the module, so it observes no behaviour`
          : blocked
          ? `${record.refusal ?? "the behavioural check could not execute"}${record.typecheck.detail === null ? "" : `: ${record.typecheck.detail.slice(0, 900)}`}`
          : outcome.detail,
      });
      // A current outcome always displaces a stale one, and an executed one
      // always displaces a blocked one: an observation beats an absence.
      const held = entries.get(outcome.facet);
      const better = held === undefined
        || (held.stale && !stale)
        || (!held.stale && !stale && (held.blocked || !blocked));
      if (better) entries.set(outcome.facet, candidate);
    }
  }
  return entries;
}

/**
 * Persist one run as durable, ignored evidence named by its own content, and
 * drop this capability's superseded records.
 *
 * A record that binds bytes the repository no longer has cannot satisfy
 * anything, and unattended operation would otherwise accumulate one file per
 * capability per cycle for every night it runs. This is ignored disposable
 * acceleration, so the current observation is the one worth keeping.
 */
export async function recordConformanceRun(repositoryRoot: string, run: ConformanceRun): Promise<string> {
  const directory = resolve(repositoryRoot, conformanceEvidenceDirectory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const digest = canonicalDigest(run);
  const path = `${conformanceEvidenceDirectory}/${digest.slice("sha256:".length)}.json`;
  await writeFile(resolve(repositoryRoot, path), `${JSON.stringify(run, null, 1)}\n`, { mode: 0o600 });

  const keep = `${digest.slice("sha256:".length)}.json`;
  for (const name of (await readdir(directory).catch(() => [] as string[]))) {
    if (name === keep || !name.endsWith(".json")) continue;
    const bytes = await readFile(resolve(directory, name), "utf8").catch(() => undefined);
    if (bytes === undefined) continue;
    try {
      const held = JSON.parse(bytes) as ConformanceRun;
      if (held.capability !== run.capability) continue;
      // Keep any record that still binds the exact current bytes; drop the rest.
      if (held.modulePathDigest === run.modulePathDigest
        && held.conformancePathDigest === run.conformancePathDigest) continue;
      await rm(resolve(directory, name), { force: true });
    } catch { continue; }
  }
  return path;
}
