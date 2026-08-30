import { mkdir, realpath } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { candidateWorkspace, RealisationError, stableReason } from "../realisation/index.ts";
import type { CommandHandler } from "./dispatcher.ts";
import { exitCodes } from "../core/errors.ts";

export interface FocusedCheck { readonly id: string; readonly command: readonly string[]; }
export interface FocusedCheckResult { readonly status: "pass" | "refused"; readonly reasonCode?: string; readonly id: string; readonly exitCode?: number; }

function confinedNodeCommand(workspace: string, command: readonly string[]): string[] | null {
  if (command.length === 0 || command[0] !== "node" || command.some((arg) => arg.startsWith("--allow-") || arg === "--permission")) return null;
  // The permission model is our safety proof: no network or child-process
  // allowance is granted, and read/write access is restricted to the copy.
  if (!process.allowedNodeEnvironmentFlags.has("--permission")) return null;
  const temporary = resolve(workspace, ".usf-check-tmp");
  return ["--permission", `--allow-fs-read=${workspace}`, `--allow-fs-write=${temporary}`, ...command.slice(1)];
}

export async function runFocusedCheck(root: string, candidateDigest: string, allowlist: readonly FocusedCheck[], id: string): Promise<FocusedCheckResult> {
  const selected = allowlist.find((entry) => entry.id === id);
  if (!selected) return { status: "refused", reasonCode: "CHECK_NOT_ALLOWLISTED", id };
  try {
    const workspace = await candidateWorkspace(await realpath(root), candidateDigest);
    const arguments_ = confinedNodeCommand(workspace, selected.command);
    if (!arguments_) return { status: "refused", reasonCode: "CHECK_CONFINEMENT_UNAVAILABLE", id };
    const temporary = resolve(workspace, ".usf-check-tmp");
    await mkdir(temporary, { recursive: true, mode: 0o700 });
    const exitCode = await new Promise<number>((finish) => {
      const child = spawn(process.execPath, arguments_, {
        cwd: workspace,
        env: { HOME: resolve(workspace, ".usf-empty-home"), TMPDIR: temporary, PATH: "" },
        stdio: "ignore",
      });
      child.once("error", () => finish(1));
      child.once("exit", (code) => finish(code ?? 1));
    });
    return exitCode === 0 ? { status: "pass", id, exitCode } : { status: "refused", reasonCode: "CHECK_FAILED", id, exitCode };
  } catch (error) {
    return { status: "refused", reasonCode: stableReason(error) ?? "CHECK_CONFINEMENT_UNAVAILABLE", id };
  }
}

/** `usf check <digest> <allowlist-json> <check-id>` with no ambient commands. */
export const checkHandler: CommandHandler = async ({ args, repositoryRoot }) => {
  if (args.length !== 3) return { output: { schema: "urn:usf:check-result:1", status: "refused", reasonCode: "INVALID_OPERATION" }, exitCode: exitCodes.INVALID_INPUT };
  try {
    const result = await runFocusedCheck(repositoryRoot, args[0]!, JSON.parse(args[1]!) as FocusedCheck[], args[2]!);
    return { output: { schema: "urn:usf:check-result:1", ...result }, exitCode: result.status === "pass" ? exitCodes.SUCCESS : exitCodes.CONTAINMENT_REFUSAL };
  } catch {
    return { output: { schema: "urn:usf:check-result:1", status: "refused", reasonCode: "INVALID_OPERATION" }, exitCode: exitCodes.INVALID_INPUT };
  }
};

export { RealisationError };
