import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface GateObservation {
  runId: string;
  startedAt: string;
  completedAt: string;
  elapsedMilliseconds: number;
  status: string;
  mode: string;
  phase: string;
  realisationBasisDigest?: string;
  resultDigest?: string;
}

/** Read-only time accounting. Matching fixture bases never establish reuse. */
export function summarizeGateHistory(runs: readonly GateObservation[]) {
  const intervals = runs.map(run => [Date.parse(run.startedAt), Date.parse(run.completedAt)])
    .sort((a, b) => a[0]! - b[0]!);
  let occupiedMilliseconds = 0;
  let end = -Infinity;
  for (const [start, stop] of intervals) {
    occupiedMilliseconds += Math.max(0, stop! - Math.max(start!, end));
    end = Math.max(end, stop!);
  }
  const windowMilliseconds = intervals.length === 0 ? 0 : end - intervals[0]![0]!;
  const summedRunMilliseconds = runs.reduce((total, run) => total + run.elapsedMilliseconds, 0);
  const groups = new Map<string, GateObservation[]>();
  for (const run of runs) {
    if (run.realisationBasisDigest === undefined) continue;
    const key = `${run.mode}:${run.realisationBasisDigest}`;
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }
  return {
    schema: "urn:usf:certification-history-observation:1",
    runCount: runs.length,
    passed: runs.filter(run => run.status === "passed").length,
    failed: runs.filter(run => run.status === "failed").length,
    summedRunMilliseconds,
    occupiedMilliseconds,
    windowMilliseconds,
    unobservedBetweenRunsMilliseconds: windowMilliseconds - occupiedMilliseconds,
    repeatedFixtureBasisGroups: [...groups.values()].filter(group => group.length > 1).map(group => ({
      fixtureBasisDigest: group[0]!.realisationBasisDigest,
      mode: group[0]!.mode,
      runIds: group.map(run => run.runId),
      elapsedMilliseconds: group.reduce((total, run) => total + run.elapsedMilliseconds, 0),
      exactCohortEquivalence: "unproven",
    })),
    nonClaims: [
      "Retained report fields are observations; this command does not authenticate certification or authorize reuse.",
      "Time between reports can include edits, focused tests, evidence, proof, publication or inactivity; attribution is unknown.",
      "A fixture-work basis is not the complete source, test, graph, toolchain and environment cohort.",
    ],
    runs,
  };
}

async function main(args: string[]) {
  if (args.length > 1 || (args[0] !== undefined && !/^[1-9][0-9]*$/u.test(args[0]))) {
    throw new Error("Usage: node scripts/certification-history.ts [maximum-reports:1..1000]");
  }
  const limit = Number(args[0] ?? 20);
  if (limit > 1000) throw new Error("At most 1000 retained reports may be read.");
  const directory = resolve(".usf/logs/full-gate");
  const names = (await readdir(directory)).filter(name => /^\d{8}T\d{9}Z-\d+\.json$/u.test(name)).sort().slice(-limit);
  const runs: GateObservation[] = [];
  const invalidReports: string[] = [];
  for (const name of names) {
    try {
      const raw = await readFile(resolve(directory, name), "utf8");
      if (raw.length > 1024 * 1024) throw new Error("report too large");
      const report = JSON.parse(raw);
      if (report.schema !== "urn:usf:full-gate-result:1" || typeof report.startedAt !== "string"
        || typeof report.completedAt !== "string" || !Number.isFinite(Date.parse(report.startedAt))
        || !Number.isFinite(Date.parse(report.completedAt)) || Date.parse(report.completedAt) < Date.parse(report.startedAt)
        || !Number.isFinite(report.elapsedMilliseconds) || report.elapsedMilliseconds < 0
        || !["passed", "failed"].includes(report.status)) throw new Error("invalid report");
      runs.push({ runId: name.slice(0, -5), startedAt: report.startedAt, completedAt: report.completedAt,
        elapsedMilliseconds: report.elapsedMilliseconds, status: report.status, mode: report.mode, phase: report.phase,
        realisationBasisDigest: report.realisationBasisDigest, resultDigest: report.resultDigest });
    } catch { invalidReports.push(name); }
  }
  process.stdout.write(JSON.stringify({ ...summarizeGateHistory(runs), invalidReports }) + "\n");
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { process.stderr.write(String(error.message) + "\n"); process.exitCode = 1; });
}
