import { realpath } from "node:fs/promises";
import { applyCandidateOperations, materialiseCandidate, RealisationError, stableReason } from "../realisation/index.ts";
import type { CandidateSpec, FileOperation } from "../realisation/index.ts";
import type { CommandHandler } from "./dispatcher.ts";
import { exitCodes } from "../core/errors.ts";

export interface ApplyInput { readonly candidate: CandidateSpec; readonly operations?: readonly FileOperation[]; }
export type ApplyResult = { readonly status: "applied"; readonly workspace: string; readonly delta: Awaited<ReturnType<typeof applyCandidateOperations>> } | { readonly status: "refused"; readonly reasonCode: string };

/** Command-facing wrapper. It deliberately has no primary-tree write path. */
export async function apply(root: string, input: ApplyInput): Promise<ApplyResult> {
  try {
    const resolvedRoot = await realpath(root);
    const materialised = await materialiseCandidate(resolvedRoot, input.candidate);
    const delta = input.operations ? await applyCandidateOperations(resolvedRoot, input.candidate.digest, input.operations) : [];
    return { status: "applied", workspace: materialised.workspace, delta };
  } catch (error) {
    return { status: "refused", reasonCode: stableReason(error) ?? "INVALID_OPERATION" };
  }
}

/** `usf apply <candidate-json>` bootstrap protocol. */
export const applyHandler: CommandHandler = async ({ args, repositoryRoot }) => {
  if (args.length !== 1) return { output: { schema: "urn:usf:apply-result:1", status: "refused", reasonCode: "INVALID_OPERATION" }, exitCode: exitCodes.INVALID_INPUT };
  try {
    const result = await apply(repositoryRoot, JSON.parse(args[0]!) as ApplyInput);
    return { output: { schema: "urn:usf:apply-result:1", ...result }, exitCode: result.status === "applied" ? exitCodes.SUCCESS : exitCodes.CONTAINMENT_REFUSAL };
  } catch {
    return { output: { schema: "urn:usf:apply-result:1", status: "refused", reasonCode: "INVALID_OPERATION" }, exitCode: exitCodes.INVALID_INPUT };
  }
};

export { RealisationError };
