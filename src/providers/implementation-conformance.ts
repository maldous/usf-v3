import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { canonicalDigest } from "../core/canonical.ts";
import { confinedNodeTestLaunch } from "../commands/check.ts";
import type { ConformanceEvidenceEntry } from "./facet-evaluation.ts";
import type { CapabilityImplementationNeed } from "./implementation-work.ts";

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
  readonly detail: string | null;
}

export interface ConformanceRun {
  readonly schema: "urn:usf:implementation-conformance-evidence:1";
  readonly version: 1;
  readonly capability: string;
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
): Promise<Readonly<{ ran: boolean; clean: boolean; detail: string | null }>> {
  const compiler = resolve(repositoryRoot, "node_modules", "typescript", "bin", "tsc");
  if (await stat(compiler).then(() => false, () => true)) {
    return Object.freeze({ ran: false, clean: false, detail: "the TypeScript compiler is not installed" });
  }
  const result = await runChild(process.execPath, [
    compiler, "--noEmit", "--strict", "--skipLibCheck",
    "--target", "es2024", "--module", "nodenext", "--moduleResolution", "nodenext",
    "--allowImportingTsExtensions", "--types", "node",
    ...paths,
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
): Promise<ConformanceRun> {
  const moduleBytes = await readFile(resolve(repositoryRoot, need.modulePath), "utf8").catch(() => undefined);
  const testBytes = await readFile(resolve(repositoryRoot, need.conformancePath), "utf8").catch(() => undefined);
  const base = {
    schema: "urn:usf:implementation-conformance-evidence:1" as const,
    version: 1 as const,
    capability: need.capability,
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
  const refused = (refusal: string): ConformanceRun => Object.freeze({
    ...base, confined: false, command: Object.freeze([]), executed: false, exitCode: null, signal: null,
    typecheck: Object.freeze({ ran: false, clean: false, detail: null }),
    reportedPassCount: 0, reportedFailCount: 0,
    outcomes: Object.freeze(need.requirements.map((requirement) => Object.freeze({
      facet: requirement.facet, facetName: requirement.canonicalName, executed: false, passed: false, detail: refusal,
    }))),
    refusal,
  });

  if (moduleBytes === undefined) return refused("the implementation module does not exist");
  if (testBytes === undefined) return refused("the conformance test does not exist");

  const compiled = await typecheck(repositoryRoot, [need.modulePath, need.conformancePath]);
  if (!compiled.clean) {
    return Object.freeze({
      ...refused("the implementation does not typecheck, so no behaviour can be observed"),
      typecheck: compiled,
    });
  }

  const scratch = resolve(repositoryRoot, ".usf", "hermes", "conformance-scratch");
  await rm(scratch, { recursive: true, force: true });
  await mkdir(scratch, { recursive: true, mode: 0o700 });
  const command = Object.freeze(["node", "--test", "--test-isolation=none", need.conformancePath]);
  const launch = confinedNodeTestLaunch(
    repositoryRoot, scratch,
    [resolve(repositoryRoot, "node_modules"), resolve(repositoryRoot, ".usf", "cache")],
    command,
  );
  if (launch === null) {
    return Object.freeze({ ...refused("the repository confinement is unavailable, so the test was not executed"), typecheck: compiled });
  }
  const result = await runChild(launch.executable, launch.arguments, repositoryRoot, conformanceTimeoutMs);
  await rm(scratch, { recursive: true, force: true });
  if (!result.launched) {
    return Object.freeze({ ...refused("the confined test process could not be launched"), typecheck: compiled, confined: true });
  }
  const parsed = parseSpecOutcomes(result.output);
  return Object.freeze({
    ...base,
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
      const passed = parsed.passed.has(name);
      const failed = parsed.failed.has(name);
      return Object.freeze({
        facet: requirement.facet,
        facetName: name,
        executed: passed || failed,
        passed,
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
): Promise<ReadonlyMap<string, ConformanceEvidenceEntry>> {
  const directory = resolve(repositoryRoot, conformanceEvidenceDirectory);
  const names = (await readdir(directory).catch(() => [] as string[])).filter((name) => name.endsWith(".json")).sort();
  const currentDigest = new Map<string, string | null>();
  const digestOf = async (path: string): Promise<string | null> => {
    if (currentDigest.has(path)) return currentDigest.get(path)!;
    const bytes = await readFile(resolve(repositoryRoot, path), "utf8").catch(() => undefined);
    const digest = bytes === undefined ? null : canonicalDigest(bytes);
    currentDigest.set(path, digest);
    return digest;
  };
  const entries = new Map<string, ConformanceEvidenceEntry>();
  for (const name of names) {
    const bytes = await readFile(resolve(directory, name), "utf8").catch(() => undefined);
    if (bytes === undefined) continue;
    let record: ConformanceRun;
    try { record = JSON.parse(bytes) as ConformanceRun; } catch { continue; }
    if (record.schema !== "urn:usf:implementation-conformance-evidence:1") continue;
    if (!record.executed || !record.confined || record.typecheck.clean !== true) continue;
    const stale = await digestOf(record.modulePath) !== record.modulePathDigest
      || await digestOf(record.conformancePath) !== record.conformancePathDigest;
    for (const outcome of record.outcomes ?? []) {
      if (typeof outcome.facet !== "string" || !outcome.executed) continue;
      const candidate: ConformanceEvidenceEntry = Object.freeze({
        executed: true, passed: outcome.passed === true, stale,
        evidence: `${record.conformancePath}@${record.conformancePathDigest.slice(0, 19)} subtest ${outcome.facetName}`,
        detail: outcome.detail,
      });
      // A current outcome always displaces a stale one; otherwise the later
      // file wins, and a failure is never silently replaced by an older pass.
      const held = entries.get(outcome.facet);
      if (held === undefined || (held.stale && !stale)) entries.set(outcome.facet, candidate);
      else if (!held.stale && !stale) entries.set(outcome.facet, candidate);
    }
  }
  return entries;
}

/** Persist one run as durable, ignored evidence named by its own content. */
export async function recordConformanceRun(repositoryRoot: string, run: ConformanceRun): Promise<string> {
  const directory = resolve(repositoryRoot, conformanceEvidenceDirectory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const digest = canonicalDigest(run);
  const path = `${conformanceEvidenceDirectory}/${digest.slice("sha256:".length)}.json`;
  await writeFile(resolve(repositoryRoot, path), `${JSON.stringify(run, null, 1)}\n`, { mode: 0o600 });
  return path;
}
