import { loadSemanticGraph } from "../graph/index.ts";
import { queryGraph, type QueryOptions } from "../graph/query.ts";
import { exitCodes, type ExitCode } from "../core/errors.ts";
import type { CommandHandler } from "./dispatcher.ts";

export function runQuery(repositoryRoot: string, options: QueryOptions, manifestPath = "graph/manifest.json"): string {
  try { return `${JSON.stringify(queryGraph(loadSemanticGraph(repositoryRoot, manifestPath), options))}\n`; }
  catch (error) { return `${JSON.stringify({ schema: "urn:usf:query-result:1", status: "refused", reasonCode: error instanceof Error ? error.message : "GRAPH_LOAD_FAILED" })}\n`; }
}

interface ParsedQueryArgs { options: QueryOptions; manifestPath: string; }

function parseQueryArgs(args: readonly string[]): ParsedQueryArgs | undefined {
  const options: QueryOptions = {};
  let manifestPath = "graph/manifest.json";
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index]; const value = args[index + 1];
    if (value === undefined) return undefined;
    if (option === "--iri") options.iri = value;
    else if (option === "--contract") options.contract = value;
    else if (option === "--selector") options.selector = value;
    else if (option === "--manifest") manifestPath = value;
    else if (option === "--max-items" && /^\d+$/.test(value)) options.maxItems = Number(value);
    else return undefined;
  }
  return { options, manifestPath };
}

export const queryCommand: CommandHandler = ({ args, repositoryRoot }) => {
  const parsed = parseQueryArgs(args);
  if (!parsed) return { output: { schema: "urn:usf:query-result:1", status: "refused", reasonCode: "QUERY_ARGUMENTS_INVALID" }, exitCode: exitCodes.INVALID_INPUT as ExitCode };
  const output = JSON.parse(runQuery(repositoryRoot, parsed.options, parsed.manifestPath)) as { status: "ok" | "refused" };
  return { output, exitCode: output.status === "ok" ? exitCodes.SUCCESS : exitCodes.INVALID_INPUT };
};
