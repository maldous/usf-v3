import { execFile } from "node:child_process";
import { dirname, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { loadCredentialEnvFile, type CredentialPresence } from "./config.ts";
import { localGitChildEnvironment } from "./local-git.ts";

const runFile = promisify(execFile);

export type CredentialInspectionReason =
  | "CREDENTIAL_FILE_TRACKED"
  | "CREDENTIAL_GIT_UNAVAILABLE";

export class CredentialInspectionError extends Error {
  readonly reasonCode: CredentialInspectionReason;

  constructor(reasonCode: CredentialInspectionReason) {
    super("The explicit credential file could not be inspected safely.");
    this.name = "CredentialInspectionError";
    this.reasonCode = reasonCode;
  }
}

export interface CredentialPresenceObservation {
  readonly source: "not-selected" | "explicit-file";
  readonly credentials: readonly CredentialPresence[];
  readonly valuesExposed: false;
}

function contained(root: string, path: string): boolean {
  const relation = relative(root, path);
  return relation !== "" && relation !== ".." && !relation.startsWith(`..${sep}`);
}

async function containingRepository(path: string, environmentRoot: string): Promise<string | undefined> {
  try {
    const result = await runFile("git", ["-C", dirname(path), "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      timeout: 5_000,
      maxBuffer: 16 * 1024,
      env: localGitChildEnvironment(environmentRoot),
    });
    const root = result.stdout.trim();
    return root.length === 0 ? undefined : resolve(root);
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === 128 || code === "128") return undefined;
    throw new CredentialInspectionError("CREDENTIAL_GIT_UNAVAILABLE");
  }
}

async function trackedByContainingRepository(path: string, environmentRoot: string): Promise<boolean> {
  const root = await containingRepository(path, environmentRoot);
  if (root === undefined || !contained(root, path)) return false;
  try {
    await runFile("git", ["-C", root, "ls-files", "--error-unmatch", "--", relative(root, path)], {
      encoding: "utf8",
      timeout: 5_000,
      maxBuffer: 16 * 1024,
      env: localGitChildEnvironment(environmentRoot),
    });
    return true;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === 1 || code === "1") return false;
    throw new CredentialInspectionError("CREDENTIAL_GIT_UNAVAILABLE");
  }
}

/**
 * Inspect only allowlisted name presence in one explicit owner-private file.
 * The path and values are intentionally absent from the returned observation.
 */
export async function inspectCredentialPresence(
  repositoryRoot: string,
  selectedPath: string | undefined,
  names: readonly string[],
): Promise<CredentialPresenceObservation> {
  const sortedNames = [...names].sort((left, right) => left.localeCompare(right));
  if (selectedPath === undefined) {
    return Object.freeze({
      source: "not-selected",
      credentials: Object.freeze(sortedNames.map((name) => Object.freeze({ name, present: false }))),
      valuesExposed: false,
    });
  }
  const absolute = resolve(repositoryRoot, selectedPath);
  if (await trackedByContainingRepository(absolute, repositoryRoot)) {
    throw new CredentialInspectionError("CREDENTIAL_FILE_TRACKED");
  }
  const loaded = await loadCredentialEnvFile(absolute, sortedNames);
  return Object.freeze({
    source: "explicit-file",
    credentials: loaded.metadata.credentials,
    valuesExposed: false,
  });
}
