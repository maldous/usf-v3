import { resolveContributions, type Resolution } from "../collaboration/index.ts";
import type { Contribution } from "../providers/index.ts";
import type { CommandHandler } from "./dispatcher.ts";
import { exitCodes, UsfError } from "../core/errors.ts";

export function resolveCommand(contributions: readonly Contribution[]): Resolution {
  return resolveContributions(contributions);
}

/** Bootstrap CLI format: a single canonical JSON array of contributions. */
export const resolveCommandHandler: CommandHandler = ({ args }) => {
  if (args.length !== 1) throw new UsfError("RESOLVE_INPUT_REQUIRED", exitCodes.INVALID_INPUT, "usf resolve requires one JSON contribution array.");
  let contributions: Contribution[];
  try { contributions = JSON.parse(args[0]!) as Contribution[]; }
  catch { throw new UsfError("RESOLVE_INPUT_INVALID", exitCodes.INVALID_INPUT, "usf resolve input must be JSON."); }
  if (!Array.isArray(contributions)) throw new UsfError("RESOLVE_CONTRIBUTIONS_REQUIRED", exitCodes.INVALID_INPUT, "usf resolve input must be an array.");
  const output = resolveCommand(contributions);
  return { output, exitCode: output.status === "refused" ? exitCodes.INTEGRATION_CONFLICT : exitCodes.SUCCESS };
};
