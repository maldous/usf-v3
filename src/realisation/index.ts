/**
 * Candidate realisation is deliberately file-operation based.  This module
 * never mutates the primary checkout: it only creates and changes copies
 * below .usf/workspaces.
 */
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export type ReasonCode =
  | "ABSOLUTE_PATH"
  | "PATH_TRAVERSAL"
  | "SYMLINK_ESCAPE"
  | "CONTROL_PATH"
  | "UNDECLARED_WRITE"
  | "STALE_RELEVANT_PREIMAGE"
  | "MISSING_WORKSPACE"
  | "INVALID_CANDIDATE_DIGEST"
  | "INVALID_OPERATION"
  | "CHECK_NOT_ALLOWLISTED"
  | "CHECK_CONFINEMENT_UNAVAILABLE"
  | "CHECK_FAILED";

export class RealisationError extends Error {
  readonly reasonCode: ReasonCode;
  constructor(reasonCode: ReasonCode, message: string) {
    super(message);
    this.name = "RealisationError";
    this.reasonCode = reasonCode;
  }
}

export type FileOperation =
  | { readonly kind: "write"; readonly path: string; readonly bytes: string }
  | { readonly kind: "delete"; readonly path: string };

export interface CandidateSpec {
  /** Content-addressed identifier supplied by the resolver. */
  readonly digest: string;
  /** Exact paths copied into the candidate from the primary checkout. */
  readonly scope: readonly string[];
  /** The only files an operation may change. */
  readonly writeSet: readonly string[];
  /** Relevant primary pre-images, encoded as sha256 hex or null when absent. */
  readonly preimages: Readonly<Record<string, string | null>>;
}

export interface MaterialisedCandidate {
  readonly workspace: string;
  readonly preimages: Readonly<Record<string, string | null>>;
}

export interface ByteDelta {
  readonly path: string;
  readonly before: string | null;
  readonly after: string | null;
  readonly beforeDigest: string | null;
  readonly afterDigest: string | null;
}

interface WorkspaceManifest {
  readonly schema: "urn:usf:workspace-manifest:1";
  readonly digest: string;
  readonly scope: readonly string[];
  readonly writeSet: readonly string[];
  readonly preimages: Readonly<Record<string, string | null>>;
  readonly baseline: Readonly<Record<string, string | null>>;
}

const manifestName = ".usf-workspace.json";
const forbiddenTopLevel = new Set([".git", ".usf", ".env"]);
const digestPattern = /^[a-f0-9]{12,128}$/;

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function checkRelative(path: string): string {
  if (!path || isAbsolute(path)) throw new RealisationError("ABSOLUTE_PATH", "Path must be repository-relative");
  const parts = path.split(/[\\/]+/);
  if (parts.some((part) => part === "..")) throw new RealisationError("PATH_TRAVERSAL", "Path traversal is forbidden");
  if (parts.some((part) => !part || part === ".")) throw new RealisationError("PATH_TRAVERSAL", "Non-canonical repository path");
  if (parts.some((part) => forbiddenTopLevel.has(part) || part === ".env" || part.startsWith(".env."))) {
    throw new RealisationError("CONTROL_PATH", "Control and credential paths are not writable");
  }
  return parts.join(sep);
}

async function assertNoSymlink(root: string, repositoryPath: string, mustExist = false): Promise<string> {
  const clean = checkRelative(repositoryPath);
  const target = resolve(root, clean);
  if (relative(root, target).startsWith("..") || isAbsolute(relative(root, target))) {
    throw new RealisationError("PATH_TRAVERSAL", "Path escapes repository root");
  }
  let cursor = root;
  for (const part of clean.split(sep)) {
    cursor = resolve(cursor, part);
    try {
      if ((await lstat(cursor)).isSymbolicLink()) throw new RealisationError("SYMLINK_ESCAPE", "Symlinks are not permitted in candidate paths");
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      throw error;
    }
  }
  if (mustExist) {
    try { await stat(target); } catch { throw new RealisationError("MISSING_WORKSPACE", "Required scoped path is missing"); }
  }
  return target;
}

async function bytesAt(root: string, repositoryPath: string): Promise<Buffer | null> {
  const target = await assertNoSymlink(root, repositoryPath);
  try {
    const entry = await lstat(target);
    if (entry.isSymbolicLink()) throw new RealisationError("SYMLINK_ESCAPE", "Symlink target is forbidden");
    if (!entry.isFile()) throw new RealisationError("INVALID_OPERATION", "Only regular files may be changed");
    return await readFile(target);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function toSnapshot(bytes: Buffer | null): string | null {
  return bytes === null ? null : bytes.toString("base64");
}

async function writeAtomically(target: string, bytes: Buffer): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.usf-${process.pid}-${Math.random().toString(16).slice(2)}`;
  await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
  await rename(temporary, target);
}

async function copyRegularTree(sourceRoot: string, workspace: string, repositoryPath: string): Promise<void> {
  const source = await assertNoSymlink(sourceRoot, repositoryPath);
  try {
    const entry = await lstat(source);
    if (entry.isFile()) {
      await writeAtomically(await assertNoSymlink(workspace, repositoryPath), await readFile(source));
      return;
    }
    if (!entry.isDirectory()) throw new RealisationError("INVALID_OPERATION", "Candidate scope must name a regular file or directory");
    for (const child of await readdir(source)) await copyRegularTree(sourceRoot, workspace, `${repositoryPath}/${child}`);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function regularFilesUnder(root: string, repositoryPath: string): Promise<string[]> {
  const target = await assertNoSymlink(root, repositoryPath);
  try {
    const entry = await lstat(target);
    if (entry.isFile()) return [repositoryPath];
    if (!entry.isDirectory()) throw new RealisationError("INVALID_OPERATION", "Candidate scope must name a regular file or directory");
    const children = await readdir(target);
    return (await Promise.all(children.map((child) => regularFilesUnder(root, `${repositoryPath}/${child}`)))).flat();
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function withinScope(path: string, scope: readonly string[]): boolean {
  return scope.some((entry) => path === entry || path.startsWith(`${entry}${sep}`));
}

async function loadManifest(workspace: string): Promise<WorkspaceManifest> {
  try {
    return JSON.parse(await readFile(resolve(workspace, manifestName), "utf8")) as WorkspaceManifest;
  } catch {
    throw new RealisationError("MISSING_WORKSPACE", "Candidate workspace manifest is missing");
  }
}

function assertDigest(candidateDigest: string): void {
  if (!digestPattern.test(candidateDigest)) throw new RealisationError("INVALID_CANDIDATE_DIGEST", "Candidate digest must be lowercase hexadecimal");
}

function workspaceFor(root: string, candidateDigest: string): string {
  assertDigest(candidateDigest);
  return resolve(root, ".usf", "workspaces", candidateDigest);
}

/** Copy only declared regular-file scope into an isolated, Git-less workspace. */
export async function materialiseCandidate(root: string, candidate: CandidateSpec): Promise<MaterialisedCandidate> {
  assertDigest(candidate.digest);
  const canonicalRoot = await realpath(root);
  const workspace = workspaceFor(canonicalRoot, candidate.digest);
  const scope = [...new Set(candidate.scope.map(checkRelative))].sort();
  const writeSet = [...new Set(candidate.writeSet.map(checkRelative))].sort();
  const preimagePaths = Object.keys(candidate.preimages).map(checkRelative).sort();
  for (const writePath of writeSet) if (!withinScope(writePath, scope) && !preimagePaths.includes(writePath)) {
    throw new RealisationError("UNDECLARED_WRITE", "Write set must be within declared candidate scope");
  }
  for (const writePath of writeSet) if (!Object.hasOwn(candidate.preimages, writePath)) {
    throw new RealisationError("STALE_RELEVANT_PREIMAGE", `Write target lacks a declared pre-image: ${writePath}`);
  }
  const scopedFiles = (await Promise.all(scope.map((path) => regularFilesUnder(canonicalRoot, path)))).flat();
  const preimages: Record<string, string | null> = {};
  const baseline: Record<string, string | null> = {};
  for (const path of [...new Set([...scopedFiles, ...preimagePaths])].sort()) {
    const bytes = await bytesAt(canonicalRoot, path);
    const actual = bytes === null ? null : digest(bytes);
    if (Object.hasOwn(candidate.preimages, path) && candidate.preimages[path] !== actual) {
      throw new RealisationError("STALE_RELEVANT_PREIMAGE", `Relevant pre-image is stale: ${path}`);
    }
    preimages[path] = actual;
    baseline[path] = toSnapshot(bytes);
  }
  await rm(workspace, { recursive: true, force: true });
  await mkdir(workspace, { recursive: true, mode: 0o700 });
  try {
    for (const path of scope) await copyRegularTree(canonicalRoot, workspace, path);
    const manifest: WorkspaceManifest = { schema: "urn:usf:workspace-manifest:1", digest: candidate.digest, scope, writeSet, preimages, baseline };
    await writeAtomically(resolve(workspace, manifestName), Buffer.from(JSON.stringify(manifest)));
    return { workspace, preimages };
  } catch (error) {
    await rm(workspace, { recursive: true, force: true });
    throw error;
  }
}

/** Apply already-resolved typed operations in the isolated tree and derive byte deltas. */
export async function applyCandidateOperations(root: string, candidateDigest: string, operations: readonly FileOperation[]): Promise<readonly ByteDelta[]> {
  const canonicalRoot = await realpath(root);
  const workspace = workspaceFor(canonicalRoot, candidateDigest);
  const manifest = await loadManifest(workspace);
  if (manifest.digest !== candidateDigest) throw new RealisationError("MISSING_WORKSPACE", "Workspace digest does not match its location");
  for (const [path, expected] of Object.entries(manifest.preimages)) {
    const actualBytes = await bytesAt(canonicalRoot, path);
    if ((actualBytes === null ? null : digest(actualBytes)) !== expected) throw new RealisationError("STALE_RELEVANT_PREIMAGE", `Relevant pre-image is stale: ${path}`);
  }
  const validated = operations.map((operation) => {
    const path = checkRelative(operation.path);
    if (!manifest.writeSet.includes(path)) throw new RealisationError("UNDECLARED_WRITE", `Write outside candidate write set: ${path}`);
    if (operation.kind === "write" && !/^[A-Za-z0-9+/]*={0,2}$/.test(operation.bytes)) throw new RealisationError("INVALID_OPERATION", "Write bytes must be base64");
    if (operation.kind !== "write" && operation.kind !== "delete") throw new RealisationError("INVALID_OPERATION", "Unknown typed operation");
    return { ...operation, path };
  });
  const changed = [...new Set(validated.map((operation) => operation.path))].sort();
  const before = new Map<string, Buffer | null>();
  for (const path of changed) before.set(path, await bytesAt(workspace, path));
  for (const operation of validated) {
    const target = await assertNoSymlink(workspace, operation.path);
    if (operation.kind === "write") await writeAtomically(target, Buffer.from(operation.bytes, "base64"));
    else await rm(target, { force: true });
  }
  return Promise.all(changed.map(async (path) => {
    const beforeBytes = before.get(path) ?? null;
    const afterBytes = await bytesAt(workspace, path);
    return { path, before: toSnapshot(beforeBytes), after: toSnapshot(afterBytes), beforeDigest: beforeBytes === null ? null : digest(beforeBytes), afterDigest: afterBytes === null ? null : digest(afterBytes) };
  }));
}

export async function candidateWorkspace(root: string, candidateDigest: string): Promise<string> {
  const workspace = workspaceFor(await realpath(root), candidateDigest);
  await loadManifest(workspace);
  return workspace;
}

export function encodeBytes(text: string): string { return Buffer.from(text).toString("base64"); }

export const stableReason = (error: unknown): ReasonCode | null => error instanceof RealisationError ? error.reasonCode : null;
