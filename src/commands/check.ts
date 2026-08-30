import { lstatSync, realpathSync } from "node:fs";
import { lstat, mkdir, realpath, rm } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { candidateWorkspace, currentCandidateWorkspace, RealisationError, stableReason, withCandidateLock } from "../realisation/index.ts";
import type { RealisationBasis } from "../realisation/basis.ts";
import type { CommandHandler } from "./dispatcher.ts";
import { exitCodes } from "../core/errors.ts";

export interface FocusedCheck { readonly id: string; readonly command: readonly string[]; }
export type FocusedCheckResult =
  | { readonly status: "pass"; readonly basis: RealisationBasis; readonly id: string; readonly exitCode: number }
  | { readonly status: "refused"; readonly basis?: RealisationBasis; readonly reasonCode: string; readonly id: string; readonly exitCode?: number };

export type PreparedFocusedCheck =
  | FocusedCheckResult
  | { readonly status: "ready"; readonly basis: RealisationBasis; readonly id: string; readonly workspace: string; readonly executable: "/usr/bin/bwrap"; readonly arguments: readonly string[] };

export interface ConfinedNodeTestLaunch {
  readonly executable: "/usr/bin/bwrap";
  readonly arguments: readonly string[];
}

const bubblewrapExecutable = "/usr/bin/bwrap" as const;

function permissionAffectingNodeArgument(argument: string): boolean {
  if (!argument.startsWith("--") || !process.allowedNodeEnvironmentFlags.has(argument)) return false;
  const normalized = argument.split("=", 1)[0]!.replaceAll("_", "-");
  return normalized === "--permission" || normalized === "--no-permission"
    || normalized.startsWith("--allow-") || normalized.startsWith("--no-allow-");
}

function strictNodeTestPaths(command: readonly string[]): readonly string[] | null {
  if (command.length < 4 || command.length > 12 || command.some((argument) => argument.length === 0)
    || command[0] !== "node" || command[1] !== "--test" || command[2] !== "--test-isolation=none"
    || command.some(permissionAffectingNodeArgument)) return null;
  const optionalNamePattern = command[3]?.startsWith("--test-name-pattern=") === true ? command[3] : undefined;
  if (optionalNamePattern !== undefined && !/^--test-name-pattern=[A-Za-z0-9._-]+$/u.test(optionalNamePattern)) return null;
  const tests = command.slice(optionalNamePattern === undefined ? 3 : 4);
  if (tests.length < 1 || tests.length > 8 || new Set(tests).size !== tests.length
    || tests.some((path) => !path.endsWith(".test.ts") || path.split("/").some((segment) => segment.length === 0 || segment === "." || segment === ".." || !/^[A-Za-z0-9._-]+$/u.test(segment)))) return null;
  return tests;
}

function trustedBubblewrap(): boolean {
  try {
    const entry = lstatSync(bubblewrapExecutable);
    if (entry.isSymbolicLink() || !entry.isFile() || entry.uid !== 0 || (entry.mode & 0o6022) !== 0
      || realpathSync(bubblewrapExecutable) !== bubblewrapExecutable) return false;
    const version = spawnSync(bubblewrapExecutable, ["--version"], { encoding: "utf8", env: {} });
    return version.error === undefined && version.status === 0 && version.signal === null && version.stdout.trim() === "bubblewrap 0.9.0";
  } catch {
    return false;
  }
}

export function confinedNodeTestLaunch(workspace: string, scratch: string, dependencyRoots: readonly string[], command: readonly string[]): ConfinedNodeTestLaunch | null {
  const tests = strictNodeTestPaths(command);
  if (tests === null || !trustedBubblewrap()) return null;
  // The permission model is our safety proof: no network or child-process
  // allowance is granted, and read/write access is restricted to the copy.
  if (!process.allowedNodeEnvironmentFlags.has("--permission")) return null;
  const canonicalWorkspace = realpathSync(workspace);
  if (canonicalWorkspace !== workspace) return null;
  for (const path of tests) {
    const target = resolve(canonicalWorkspace, path);
    const relation = relative(canonicalWorkspace, target);
    if (relation === "" || relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) return null;
    try {
      const entry = lstatSync(target);
      if (entry.isSymbolicLink() || !entry.isFile()) return null;
      const realRelation = relative(canonicalWorkspace, realpathSync(target));
      if (realRelation === "" || realRelation === ".." || realRelation.startsWith(`..${sep}`) || isAbsolute(realRelation)) return null;
    } catch {
      return null;
    }
  }
  const scratchRelation = relative(canonicalWorkspace, resolve(scratch));
  if (scratchRelation === "" || scratchRelation === ".." || scratchRelation.startsWith(`..${sep}`) || isAbsolute(scratchRelation)) return null;
  const nodeArguments = [
    "--permission",
    `--allow-fs-read=${canonicalWorkspace}`,
    ...dependencyRoots.map((root) => `--allow-fs-read=${root}`),
    "--allow-fs-read=/etc/passwd",
    "--allow-fs-read=/proc/net/route",
    `--allow-fs-write=${resolve(scratch)}`,
    ...command.slice(1),
  ];
  const environment = [
    ["HOME", resolve(canonicalWorkspace, ".usf-empty-home")],
    ["LANG", "C.UTF-8"],
    ["LC_ALL", "C.UTF-8"],
    ["NODE_PATH", dependencyRoots[0] ?? ""],
    ["PATH", ""],
    ["TMPDIR", resolve(scratch)],
    ["USF_BWRAP_NETWORK", "isolated"],
    ["USF_PROVIDER_HOME", resolve(canonicalWorkspace, ".usf/provider-home")],
    ["USF_REPOSITORY_ROOT", canonicalWorkspace],
  ] as const;
  return Object.freeze({
    executable: bubblewrapExecutable,
    arguments: Object.freeze([
      "--unshare-user", "--unshare-pid", "--unshare-net", "--die-with-parent",
      "--tmpfs", "/",
      ...["/usr", "/lib", "/lib64", canonicalWorkspace, ...dependencyRoots]
        .flatMap((path) => ["--ro-bind", path, path]),
      "--proc", "/proc", "--dev", "/dev",
      "--bind", resolve(scratch), resolve(scratch),
      "--chdir", canonicalWorkspace, "--clearenv",
      ...environment.flatMap(([name, value]) => ["--setenv", name, value]),
      "--", process.execPath, ...nodeArguments,
    ]),
  });
}

async function toolDependencyRoots(): Promise<readonly string[]> {
  let candidate = resolve(import.meta.dirname, "../..");
  for (;;) {
    try {
      return await Promise.all([
        realpath(resolve(candidate, "node_modules")),
        realpath(resolve(candidate, ".usf/cache")),
      ]);
    } catch {
      const parent = dirname(candidate);
      if (parent === candidate) throw new Error("TOOL_DEPENDENCY_ROOT_UNAVAILABLE");
      candidate = parent;
    }
  }
}

/** Pure admission boundary for tests and callers that must not spawn a nested process. */
async function prepareFocusedCheckCurrent(root: string, candidateDigest: string, allowlist: readonly FocusedCheck[], id: string): Promise<PreparedFocusedCheck> {
  const current = await currentCandidateWorkspace(root, candidateDigest);
  const { workspace, basis } = current;
  const selected = allowlist.find((entry) => entry.id === id);
  if (!selected) return { status: "refused", basis, reasonCode: "CHECK_NOT_ALLOWLISTED", id };
  const dependencyRoots = await toolDependencyRoots();
  const launch = confinedNodeTestLaunch(workspace, resolve(workspace, ".usf-check-tmp"), dependencyRoots, selected.command);
  if (!launch) return { status: "refused", basis, reasonCode: "CHECK_CONFINEMENT_UNAVAILABLE", id };
  return { status: "ready", basis, id, workspace, executable: launch.executable, arguments: launch.arguments };
}

/** Pure readiness boundary: it performs no child execution and holds no execution lock. */
export async function prepareFocusedCheck(root: string, candidateDigest: string, allowlist: readonly FocusedCheck[], id: string): Promise<PreparedFocusedCheck> {
  try {
    return await prepareFocusedCheckCurrent(await realpath(root), candidateDigest, allowlist, id);
  } catch (error) {
    return { status: "refused", reasonCode: stableReason(error) ?? "CHECK_CONFINEMENT_UNAVAILABLE", id };
  }
}

async function resetFocusedCheckTemporary(workspace: string): Promise<string> {
  const temporary = resolve(workspace, ".usf-check-tmp");
  try {
    const entry = await lstat(temporary);
    if (entry.isSymbolicLink() || !entry.isDirectory()) throw new RealisationError("CANDIDATE_BASIS_MISMATCH", "Focused-check temporary path is not a controlled directory");
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await rm(temporary, { recursive: true, force: true });
  await mkdir(temporary, { recursive: true, mode: 0o700 });
  return temporary;
}

export async function runFocusedCheck(root: string, candidateDigest: string, allowlist: readonly FocusedCheck[], id: string): Promise<FocusedCheckResult> {
  try {
    return await withCandidateLock(root, candidateDigest, async (canonicalRoot) => {
      const workspaceBeforeAuthentication = await candidateWorkspace(canonicalRoot, candidateDigest);
      await resetFocusedCheckTemporary(workspaceBeforeAuthentication);
      const prepared = await prepareFocusedCheckCurrent(canonicalRoot, candidateDigest, allowlist, id);
      if (prepared.status !== "ready") return prepared;
      const { workspace, basis, executable, arguments: arguments_ } = prepared;
      const temporary = resolve(workspace, ".usf-check-tmp");
      try {
        const exitCode = await new Promise<number>((finish) => {
          const child = spawn(executable, arguments_, {
            cwd: workspace,
            env: {},
            stdio: "ignore",
          });
          child.once("error", () => finish(1));
          child.once("exit", (code) => finish(code ?? 1));
        });
        return exitCode === 0 ? { status: "pass", basis, id, exitCode } : { status: "refused", basis, reasonCode: "CHECK_FAILED", id, exitCode };
      } finally {
        await resetFocusedCheckTemporary(workspace);
      }
    });
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
