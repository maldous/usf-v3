import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { UsfError, exitCodes } from "./errors.ts";

export function resolveRepositoryRoot(cwd = process.cwd()): string {
  try { return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { throw new UsfError("REPOSITORY_REQUIRED", exitCodes.INVALID_INPUT, "Run this command inside a Git repository."); }
}

export function resolveRepositoryPath(repositoryRoot: string, candidate: string): string {
  if (!candidate || candidate.startsWith("/") || candidate.startsWith("\\")) throw new UsfError("REPOSITORY_RELATIVE_PATH_REQUIRED", exitCodes.CONTAINMENT_REFUSAL, "Output paths must be repository-relative.");
  const absolute = resolve(repositoryRoot, candidate);
  if (absolute !== repositoryRoot && !absolute.startsWith(`${repositoryRoot}/`)) throw new UsfError("PATH_ESCAPES_REPOSITORY", exitCodes.CONTAINMENT_REFUSAL, "Path escapes the repository.", { candidate });
  return absolute;
}
