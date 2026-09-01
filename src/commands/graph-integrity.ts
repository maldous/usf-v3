import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { exitCodes, UsfError } from "../core/errors.ts";
import { checkIntegrity, type IntegrityOptions } from "../graph/integrity.ts";
import { parseStrictNQuads, type Quad } from "../graph/nquads.ts";
import type { CommandResult } from "./dispatcher.ts";

/**
 * Graphs authored before the canonical convention was declared. Structural
 * invariants still apply to them; local-name style and the state-reason
 * convention do not, because correcting those would mutate resources owned by
 * completed work and change their digests.
 */
const conventionExemptGraphs: readonly string[] = Object.freeze([
  "urn:usf:graph:anqr-first-slice", "urn:usf:graph:foundation", "urn:usf:graph:hermes-management",
  "urn:usf:graph:integration", "urn:usf:graph:profile-authority", "urn:usf:graph:provider-pipeline",
  "urn:usf:graph:provider-qualification", "urn:usf:graph:semantic-first",
  "urn:usf:graph:semantic-recovery", "urn:usf:graph:usf-bootstrap",
]);

/** Graphs that opted into the state-reason convention. */
const stateReasonGraphs: readonly string[] = Object.freeze([
  "urn:usf:graph:v3-convention", "urn:usf:graph:v3-execution",
]);

/** Known legacy ownership overlap, recorded rather than silently rewritten. */
const acceptedLegacyDebtCount = 24;

/** The scopes the integrity gate applies, shared with the transaction validator. */
export function integrityScopes(): Readonly<{ conventionExemptGraphs: readonly string[]; stateReasonGraphs: readonly string[] }> {
  return Object.freeze({ conventionExemptGraphs, stateReasonGraphs });
}

export async function graphIntegrityCommand(repositoryRoot: string, args: readonly string[]): Promise<CommandResult> {
  const strict = args.includes("--strict");
  if (args.some((argument) => argument !== "--strict")) {
    throw new UsfError("GRAPH_INTEGRITY_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT,
      "Graph integrity accepts only --strict.");
  }
  const directory = resolve(repositoryRoot, "graph");
  const names = (await readdir(directory).catch(() => [] as string[])).filter((name) => name.endsWith(".nq")).sort();
  const quads: Quad[] = [];
  const unparsed: string[] = [];
  for (const name of names) {
    const source = await readFile(resolve(directory, name), "utf8").catch(() => undefined);
    if (source === undefined) { unparsed.push(name); continue; }
    const firstLine = source.split("\n").find((line) => line.trim().length > 0) ?? "";
    const graph = /<([^>]+)> \.$/u.exec(firstLine)?.[1];
    if (graph === undefined) { unparsed.push(name); continue; }
    try { quads.push(...parseStrictNQuads(source, graph, 200_000)); }
    catch { unparsed.push(name); }
  }
  const options: IntegrityOptions = Object.freeze({ conventionExemptGraphs, stateReasonGraphs });
  const report = checkIntegrity(quads, options);
  const ownedViolations = report.violations.filter(
    (violation) => !conventionExemptGraphs.includes(violation.graph) && violation.graph.length > 0,
  );
  const legacyViolations = report.violations.length - ownedViolations.length;

  const output = Object.freeze({
    ...report,
    sourceFileCount: names.length,
    unparsedFiles: Object.freeze(unparsed),
    ownedGraphViolationCount: ownedViolations.length,
    legacyGraphViolationCount: legacyViolations,
    acceptedLegacyDebtCount,
    withinAcceptedDebt: legacyViolations <= acceptedLegacyDebtCount,
    // Conformance for the gate: V3-owned graphs must be clean, and legacy debt
    // must not grow beyond what is explicitly recorded.
    gateConforming: ownedViolations.length === 0 && legacyViolations <= acceptedLegacyDebtCount && unparsed.length === 0,
  });
  const failing = strict ? !report.conforming : !output.gateConforming;
  return { output, exitCode: failing ? exitCodes.DOMAIN_FAILURE : exitCodes.SUCCESS };
}
