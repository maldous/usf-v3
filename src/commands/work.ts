import { loadSemanticGraph } from "../graph/index.ts";
import { deriveWork, type WorkOptions } from "../graph/work.ts";
import { exitCodes, type ExitCode } from "../core/errors.ts";
import type { CommandHandler } from "./dispatcher.ts";

export function runWork(repositoryRoot: string, options: WorkOptions = {}, manifestPath = "graph/manifest.json"): string {
  try { return `${JSON.stringify(deriveWork(loadSemanticGraph(repositoryRoot, manifestPath), options))}\n`; }
  catch (error) { return `${JSON.stringify({ schema: "urn:usf:work-result:1", status: "refused", reasonCode: error instanceof Error ? error.message : "GRAPH_LOAD_FAILED" })}\n`; }
}

interface ParsedWorkArgs { options: WorkOptions; manifestPath: string; }

function parseWorkArgs(args: readonly string[]): ParsedWorkArgs | undefined {
  const options: WorkOptions = {};
  let manifestPath = "graph/manifest.json";
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option === "--ready") options.ready = true;
    else if (option === "--stream") options.stream = true;
    else if (["--selector", "--profile", "--stage", "--shard", "--max-items", "--manifest"].includes(option)) {
      const value = args[++index]; if (value === undefined) return undefined;
      if (option === "--selector") options.selector = value;
      if (option === "--profile") options.profile = value;
      if (option === "--stage" && (value === "construct" || value === "integrate")) options.stage = value;
      else if (option === "--stage") return undefined;
      if (option === "--shard") options.shard = value;
      if (option === "--manifest") manifestPath = value;
      if (option === "--max-items" && /^\d+$/.test(value)) options.maxItems = Number(value);
      else if (option === "--max-items") return undefined;
    } else return undefined;
  }
  return { options, manifestPath };
}

export const workCommand: CommandHandler = ({ args, repositoryRoot }) => {
  const parsed = parseWorkArgs(args);
  if (!parsed) return { output: { schema: "urn:usf:work-result:1", status: "refused", reasonCode: "WORK_ARGUMENTS_INVALID" }, exitCode: exitCodes.INVALID_INPUT as ExitCode };
  const output = JSON.parse(runWork(repositoryRoot, parsed.options, parsed.manifestPath)) as { status: "ok" | "refused" };
  return { output, exitCode: output.status === "ok" ? exitCodes.SUCCESS : exitCodes.INVALID_INPUT };
};
