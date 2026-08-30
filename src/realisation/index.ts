/**
 * Candidate realisation is deliberately file-operation based.  This module
 * never mutates the primary checkout: it only creates and changes copies
 * below .usf/workspaces.
 */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { canonicalDigest } from "../core/canonical.ts";
import { deriveCurrentRealisationBasis } from "../graph/work.ts";
import { isOperation, type FileOperation as ResolvedFileOperation } from "../providers/types.ts";
import {
  assertRealisationBasis,
  assertSameBasis,
  createRealisationBasis,
  type BasisDraft,
  type RealisationBasis,
} from "./basis.ts";

export type ReasonCode =
  | "ABSOLUTE_PATH"
  | "PATH_TRAVERSAL"
  | "SYMLINK_ESCAPE"
  | "CONTROL_PATH"
  | "UNDECLARED_WRITE"
  | "STALE_RELEVANT_PREIMAGE"
  | "INVALID_REALISATION_BASIS"
  | "STALE_REALISATION_BASIS"
  | "CANDIDATE_BASIS_MISMATCH"
  | "CANDIDATE_BUSY"
  | "CANDIDATE_LOCK_UNAVAILABLE"
  | "INVALID_WORKSPACE_MANIFEST"
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
  /** Exact content-addressed identity supplied by the resolver. */
  readonly digest: string;
  /** The one graph-derived authority basis carried by the resolved candidate. */
  readonly basis: RealisationBasis;
  /** Exact resolver operations used to derive the candidate identity. */
  readonly operations: readonly ResolvedFileOperation[];
  readonly lineage: Readonly<{
    readonly acceptedContributionDigests: readonly string[];
    readonly rejected: readonly unknown[];
  }>;
  /** Exact paths copied into the candidate from the primary checkout. */
  readonly scope: readonly string[];
  /** The exact operation paths; a subset of the basis write scope. */
  readonly writeSet: readonly string[];
  /** Exact basis pre-images for the operation paths, as sha256 identities or null. */
  readonly preimages: Readonly<Record<string, string | null>>;
}

export interface MaterialisedCandidate {
  readonly workspace: string;
  readonly basis: RealisationBasis;
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
  readonly basis: RealisationBasis;
  readonly operations: readonly ResolvedFileOperation[];
  readonly lineage: Readonly<{
    readonly acceptedContributionDigests: readonly string[];
    readonly rejected: readonly unknown[];
  }>;
  readonly scope: readonly string[];
  readonly writeSet: readonly string[];
  readonly preimages: Readonly<Record<string, string | null>>;
}

const manifestName = ".usf-workspace.json";
const forbiddenTopLevel = new Set([".git", ".usf", ".env"]);
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const digestHexPattern = /^[a-f0-9]{64}$/;

function digest(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
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

function checkScopePath(path: string): string {
  return checkRelative(path.endsWith("/") ? path.slice(0, -1) : path);
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

function withinScope(path: string, scope: readonly string[]): boolean {
  return scope.some((entry) => path === entry || path.startsWith(`${entry}${sep}`));
}

function rehydrateBasis(value: unknown): RealisationBasis {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RealisationError("INVALID_REALISATION_BASIS", "Workspace basis is missing or malformed");
  }
  try {
    const { basisDigest, ...draft } = value as RealisationBasis;
    const basis = createRealisationBasis(draft as BasisDraft);
    if (basis.basisDigest !== basisDigest) throw new Error("BASIS_DIGEST_MISMATCH");
    assertRealisationBasis(basis);
    return basis;
  } catch {
    throw new RealisationError("INVALID_REALISATION_BASIS", "Workspace basis is missing or malformed");
  }
}

function assertExactKeys(value: object, keys: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new RealisationError("INVALID_WORKSPACE_MANIFEST", "Workspace manifest has an unknown or missing field");
  }
}

async function loadManifest(sourceRoot: string, workspace: string): Promise<WorkspaceManifest> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(resolve(workspace, manifestName), "utf8"));
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new RealisationError("INVALID_WORKSPACE_MANIFEST", "Candidate workspace manifest is invalid");
    }
    throw new RealisationError("MISSING_WORKSPACE", "Candidate workspace manifest is missing");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RealisationError("INVALID_WORKSPACE_MANIFEST", "Candidate workspace manifest is invalid");
  }
  assertExactKeys(value, ["schema", "digest", "basis", "operations", "lineage", "scope", "writeSet", "preimages"]);
  const manifest = value as WorkspaceManifest;
  if (manifest.schema !== "urn:usf:workspace-manifest:1" || !digestPattern.test(manifest.digest)
    || !Array.isArray(manifest.operations) || !manifest.lineage || typeof manifest.lineage !== "object" || Array.isArray(manifest.lineage)
    || !Array.isArray(manifest.lineage.acceptedContributionDigests) || !Array.isArray(manifest.lineage.rejected)
    || !Array.isArray(manifest.scope) || !Array.isArray(manifest.writeSet)
    || !manifest.preimages || typeof manifest.preimages !== "object" || Array.isArray(manifest.preimages)) {
    throw new RealisationError("INVALID_WORKSPACE_MANIFEST", "Candidate workspace manifest is invalid");
  }
  assertExactKeys(manifest.lineage, ["acceptedContributionDigests", "rejected"]);
  const basis = rehydrateBasis(manifest.basis);
  const candidate = { ...manifest, basis };
  const operations = normalizedResolvedOperations(candidate.operations);
  if (candidate.digest !== expectedCandidateDigest(candidate, operations)) {
    throw new RealisationError("CANDIDATE_BASIS_MISMATCH", "Workspace candidate identity does not match its basis, operations and lineage");
  }
  const scope = candidateScope(basis);
  const writeSet = operations.map((operation) => operation.path).sort();
  const allowedWrites = basis.scope.writeSet.map(checkScopePath);
  if (writeSet.some((path) => !withinScope(path, allowedWrites))) {
    throw new RealisationError("UNDECLARED_WRITE", "Workspace candidate exceeds its basis write scope");
  }
  const preimages = await deriveCandidatePreimages(sourceRoot, basis, writeSet);
  if (!sameJson(candidate.scope.map(checkScopePath), scope)
    || !sameJson(candidate.writeSet.map(checkRelative), writeSet)
    || !sameJson(candidate.preimages, preimages)) {
    throw new RealisationError("CANDIDATE_BASIS_MISMATCH", "Workspace scope, write set or pre-images do not match its basis");
  }
  return { ...candidate, operations };
}

function assertDigest(candidateDigest: string): void {
  if (!digestPattern.test(candidateDigest)) throw new RealisationError("INVALID_CANDIDATE_DIGEST", "Candidate digest must be a sha256 identity");
}

function workspaceFor(root: string, candidateDigest: string): string {
  const hex = digestPattern.test(candidateDigest) ? candidateDigest.slice("sha256:".length) : candidateDigest;
  if (!digestHexPattern.test(hex)) throw new RealisationError("INVALID_CANDIDATE_DIGEST", "Candidate digest must be a sha256 identity");
  return resolve(root, ".usf", "workspaces", hex);
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const entry = await lstat(path);
  if (entry.isSymbolicLink() || !entry.isDirectory()) throw new RealisationError("CANDIDATE_LOCK_UNAVAILABLE", "Candidate lock directory is not a private directory");
  await chmod(path, 0o700);
}

async function acquireCandidateLock(root: string, candidateDigest: string): Promise<Awaited<ReturnType<typeof open>>> {
  assertDigest(candidateDigest);
  const locksRoot = resolve(root, ".usf", "locks", "candidates");
  await ensurePrivateDirectory(resolve(root, ".usf"));
  await ensurePrivateDirectory(resolve(root, ".usf", "locks"));
  await ensurePrivateDirectory(locksRoot);
  const handle = await open(
    resolve(locksRoot, `${candidateDigest.slice("sha256:".length)}.lock`),
    constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    0o600,
  ).catch(() => { throw new RealisationError("CANDIDATE_LOCK_UNAVAILABLE", "Candidate lock file cannot be opened safely"); });
  try {
    if (!(await handle.stat()).isFile()) throw new RealisationError("CANDIDATE_LOCK_UNAVAILABLE", "Candidate lock is not a regular file");
    await handle.chmod(0o600);
    const exitCode = await new Promise<number>((finish) => {
      const child = spawn("/usr/bin/flock", ["--nonblock", "--conflict-exit-code", "75", "3"], {
        stdio: ["ignore", "ignore", "ignore", handle.fd],
      });
      let settled = false;
      const settle = (code: number) => {
        if (settled) return;
        settled = true;
        finish(code);
      };
      child.once("error", () => settle(127));
      child.once("exit", (code) => settle(code ?? 127));
    });
    if (exitCode === 75) throw new RealisationError("CANDIDATE_BUSY", "Candidate is held by another cooperative USF operation");
    if (exitCode !== 0) throw new RealisationError("CANDIDATE_LOCK_UNAVAILABLE", "util-linux flock could not acquire the candidate lock");
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

export async function withCandidateLock<T>(root: string, candidateDigest: string, operation: (canonicalRoot: string) => Promise<T>): Promise<T> {
  const canonicalRoot = await realpath(root);
  const handle = await acquireCandidateLock(canonicalRoot, candidateDigest);
  try {
    return await operation(canonicalRoot);
  } finally {
    await handle.close();
  }
}

function normalizedResolvedOperations(operations: readonly ResolvedFileOperation[]): ResolvedFileOperation[] {
  if (!Array.isArray(operations) || operations.length === 0 || !operations.every(isOperation)) {
    throw new RealisationError("INVALID_OPERATION", "Candidate requires exact typed resolver operations");
  }
  const paths = operations.map((operation) => checkRelative(operation.path));
  if (new Set(paths).size !== paths.length) throw new RealisationError("INVALID_OPERATION", "Candidate operations must target distinct paths");
  const orderedPaths = [...paths].sort();
  if (paths.some((path, index) => path !== orderedPaths[index])) throw new RealisationError("INVALID_OPERATION", "Candidate operations must use deterministic path order");
  return operations.map((operation, index) => ({ ...operation, path: paths[index]! }));
}

export function candidateOperations(candidate: Pick<CandidateSpec, "operations">): readonly FileOperation[] {
  return normalizedResolvedOperations(candidate.operations).map((operation) => operation.kind === "write"
    ? { kind: "write", path: operation.path, bytes: operation.encoding === "base64" ? operation.content ?? "" : encodeBytes(operation.content ?? "") }
    : { kind: "delete", path: operation.path });
}

function expectedCandidateDigest(candidate: Pick<CandidateSpec, "basis" | "lineage">, operations: readonly ResolvedFileOperation[]): string {
  if (!Array.isArray(candidate.lineage.acceptedContributionDigests) || !Array.isArray(candidate.lineage.rejected)
    || candidate.lineage.rejected.length !== 0 || candidate.lineage.acceptedContributionDigests.length === 0
    || candidate.lineage.acceptedContributionDigests.some((entry) => typeof entry !== "string" || !digestPattern.test(entry))) {
    throw new RealisationError("CANDIDATE_BASIS_MISMATCH", "Candidate lineage is not an exact resolved lineage");
  }
  const ordered = [...candidate.lineage.acceptedContributionDigests].sort();
  if (new Set(ordered).size !== ordered.length || ordered.some((entry, index) => entry !== candidate.lineage.acceptedContributionDigests[index])) {
    throw new RealisationError("CANDIDATE_BASIS_MISMATCH", "Candidate lineage is not in deterministic resolver order");
  }
  return canonicalDigest({
    basisDigest: candidate.basis.basisDigest,
    operations,
    acceptedContributionDigests: candidate.lineage.acceptedContributionDigests,
  }, { rejectAbsolutePaths: true });
}

async function currentBasis(root: string, value: unknown): Promise<RealisationBasis> {
  let basis: RealisationBasis;
  try {
    basis = rehydrateBasis(value);
  } catch {
    throw new RealisationError("INVALID_REALISATION_BASIS", "Candidate requires one valid immutable realisation basis");
  }
  try {
    const current = await deriveCurrentRealisationBasis(root, basis);
    assertSameBasis(basis, current);
    return current;
  } catch {
    throw new RealisationError("STALE_REALISATION_BASIS", "Candidate realisation basis is not current");
  }
}

export function candidateScope(basis: RealisationBasis): string[] {
  const fileDependencies = basis.work.dependencies
    .filter((dependency) => dependency.kind !== "semantic-resource")
    .map((dependency) => dependency.key);
  return [...new Set([...basis.scope.readSet, ...basis.scope.writeSet, ...fileDependencies].map(checkScopePath))].sort();
}

export async function deriveCandidatePreimages(root: string, basis: RealisationBasis, writeSet: readonly string[]): Promise<Record<string, string | null>> {
  const canonicalRoot = await realpath(root);
  const expected: Record<string, string | null> = {};
  for (const candidatePath of writeSet) {
    const path = checkRelative(candidatePath);
    const directoryScopes = basis.scope.writeSet.filter((entry) => entry.endsWith("/") && path.startsWith(entry));
    const derived: Array<string | null> = [];
    if (Object.hasOwn(basis.scope.preimages, path)) derived.push(basis.scope.preimages[path]!);
    for (const directoryScope of directoryScopes) {
      const dependencies = basis.work.dependencies.filter((dependency) => dependency.kind === "file" && dependency.key === directoryScope);
      if (dependencies.length !== 1) throw new RealisationError("CANDIDATE_BASIS_MISMATCH", `Directory write scope lacks one exact basis dependency: ${directoryScope}`);
      const leaves = await directoryLeafDigests(canonicalRoot, directoryScope);
      if (canonicalDigest(leaves) !== dependencies[0]!.digest) throw new RealisationError("STALE_REALISATION_BASIS", `Directory write scope aggregate is stale: ${directoryScope}`);
      derived.push(leaves.find((leaf) => leaf.path === path)?.digest ?? null);
    }
    if (derived.length === 0) throw new RealisationError("STALE_RELEVANT_PREIMAGE", `Write target lacks exact or directory-aggregate preimage authority: ${path}`);
    if (derived.some((value) => value !== derived[0])) throw new RealisationError("CANDIDATE_BASIS_MISMATCH", `Overlapping directory write scopes disagree on the target preimage: ${path}`);
    expected[path] = derived[0]!;
  }
  return expected;
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalDigest(left, { rejectAbsolutePaths: true }) === canonicalDigest(right, { rejectAbsolutePaths: true });
}

async function validateCandidate(root: string, candidate: CandidateSpec): Promise<{
  basis: RealisationBasis;
  operations: readonly ResolvedFileOperation[];
  scope: string[];
  writeSet: string[];
  preimages: Record<string, string | null>;
}> {
  assertDigest(candidate.digest);
  const basis = await currentBasis(root, candidate.basis);
  const operations = normalizedResolvedOperations(candidate.operations);
  if (candidate.digest !== expectedCandidateDigest(candidate, operations)) {
    throw new RealisationError("CANDIDATE_BASIS_MISMATCH", "Candidate artifact digest does not bind its basis, operations and lineage");
  }
  const scope = candidateScope(basis);
  const writeSet = [...new Set(operations.map((operation) => operation.path))].sort();
  const allowedWrites = basis.scope.writeSet.map(checkScopePath);
  for (const path of writeSet) if (!withinScope(path, allowedWrites)) {
    throw new RealisationError("UNDECLARED_WRITE", `Write outside basis scope: ${path}`);
  }
  const preimages = await deriveCandidatePreimages(root, basis, writeSet);
  if (!sameJson(candidate.scope.map(checkScopePath), scope)
    || !sameJson(candidate.writeSet.map(checkRelative), writeSet)
    || !sameJson(candidate.preimages, preimages)) {
    throw new RealisationError("CANDIDATE_BASIS_MISMATCH", "Candidate scope, write set or pre-images do not match its basis");
  }
  return { basis, operations, scope, writeSet, preimages };
}

/** Copy only declared regular-file scope into an isolated, Git-less workspace. */
export async function materialiseCandidate(root: string, candidate: CandidateSpec): Promise<MaterialisedCandidate> {
  return withCandidateLock(root, candidate.digest, async (canonicalRoot) => {
    const validated = await validateCandidate(canonicalRoot, candidate);
    const workspace = workspaceFor(canonicalRoot, candidate.digest);
    const { basis, scope, writeSet, preimages: declaredPreimages } = validated;
    const preimagePaths = Object.keys(declaredPreimages).sort();
    for (const path of preimagePaths) {
      const bytes = await bytesAt(canonicalRoot, path);
      const actual = bytes === null ? null : digest(bytes);
      if (Object.hasOwn(declaredPreimages, path) && declaredPreimages[path] !== actual) {
        throw new RealisationError("STALE_RELEVANT_PREIMAGE", `Relevant pre-image is stale: ${path}`);
      }
    }
    await rm(workspace, { recursive: true, force: true });
    await mkdir(workspace, { recursive: true, mode: 0o700 });
    try {
      for (const path of scope) await copyRegularTree(canonicalRoot, workspace, path);
      const manifest: WorkspaceManifest = {
        schema: "urn:usf:workspace-manifest:1",
        digest: candidate.digest,
        basis,
        operations: validated.operations,
        lineage: { acceptedContributionDigests: [...candidate.lineage.acceptedContributionDigests], rejected: [] },
        scope,
        writeSet,
        preimages: declaredPreimages,
      };
      await writeAtomically(resolve(workspace, manifestName), Buffer.from(JSON.stringify(manifest)));
      return { workspace, basis, preimages: declaredPreimages };
    } catch (error) {
      await rm(workspace, { recursive: true, force: true });
      throw error;
    }
  });
}

/** Apply already-resolved typed operations in the isolated tree and derive byte deltas. */
export async function applyCandidateOperations(root: string, candidateDigest: string, operations: readonly FileOperation[]): Promise<readonly ByteDelta[]> {
  return withCandidateLock(root, candidateDigest, async (canonicalRoot) => {
    const workspace = workspaceFor(canonicalRoot, candidateDigest);
    const manifest = await loadManifest(canonicalRoot, workspace);
    const fullDigest = digestPattern.test(candidateDigest) ? candidateDigest : `sha256:${candidateDigest}`;
    if (manifest.digest !== fullDigest) throw new RealisationError("MISSING_WORKSPACE", "Workspace digest does not match its location");
    await currentBasis(canonicalRoot, manifest.basis);
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
    if (canonicalDigest(validated, { rejectAbsolutePaths: true }) !== canonicalDigest(candidateOperations(manifest), { rejectAbsolutePaths: true })) {
      throw new RealisationError("CANDIDATE_BASIS_MISMATCH", "Applied operations do not match the resolved candidate identity");
    }
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
  });
}

export async function candidateWorkspace(root: string, candidateDigest: string): Promise<string> {
  const canonicalRoot = await realpath(root);
  const workspace = workspaceFor(canonicalRoot, candidateDigest);
  await loadManifest(canonicalRoot, workspace);
  return workspace;
}

async function directoryLeafDigests(root: string, declaredPath: string): Promise<Array<{ path: string; digest: string }>> {
  const directory = await assertNoSymlink(root, checkScopePath(declaredPath), true);
  if (!(await lstat(directory)).isDirectory()) throw new RealisationError("CANDIDATE_BASIS_MISMATCH", `Basis directory dependency is not a directory: ${declaredPath}`);
  const walk = async (current: string): Promise<Array<{ path: string; digest: string }>> => {
    const names = (await readdir(current)).sort((left, right) => left.localeCompare(right));
    const leaves: Array<{ path: string; digest: string }> = [];
    for (const name of names) {
      const child = resolve(current, name);
      const entry = await lstat(child);
      if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) {
        throw new RealisationError("CANDIDATE_BASIS_MISMATCH", `Basis directory contains a symlink or nonregular leaf: ${declaredPath}`);
      }
      if (entry.isDirectory()) leaves.push(...await walk(child));
      else leaves.push({ path: relative(root, child).split(sep).join("/"), digest: digest(await readFile(child)) });
    }
    return leaves;
  };
  return walk(directory);
}

async function assertWorkspaceCandidateBytes(sourceRoot: string, workspace: string, manifest: WorkspaceManifest): Promise<void> {
  const operations = new Map(manifest.operations.map((operation) => [operation.path, operation]));
  const sourceDigests = new Map<string, string | null>();
  const addSourceDigest = (path: string, sourceDigest: string | null) => {
    const existing = sourceDigests.get(path);
    if (existing !== undefined && existing !== null && sourceDigest !== null && existing !== sourceDigest) {
      throw new RealisationError("CANDIDATE_BASIS_MISMATCH", `Candidate basis has conflicting source digests: ${path}`);
    }
    if (!sourceDigests.has(path)) sourceDigests.set(path, sourceDigest);
  };
  const addBasisPath = async (path: string, sourceDigest: string | null) => {
    if (!path.endsWith("/")) {
      addSourceDigest(checkScopePath(path), sourceDigest);
      return;
    }
    if (sourceDigest === null) throw new RealisationError("CANDIDATE_BASIS_MISMATCH", `Basis directory aggregate is missing: ${path}`);
    const leaves = await directoryLeafDigests(sourceRoot, path);
    if (canonicalDigest(leaves) !== sourceDigest) throw new RealisationError("CANDIDATE_BASIS_MISMATCH", `Basis directory aggregate is stale: ${path}`);
    for (const leaf of leaves) addSourceDigest(leaf.path, leaf.digest);
  };

  const operationPreimages = await deriveCandidatePreimages(sourceRoot, manifest.basis, manifest.writeSet);
  for (const [path, preimage] of Object.entries(operationPreimages)) addSourceDigest(path, preimage);
  for (const [path, preimage] of Object.entries(manifest.basis.scope.preimages)) await addBasisPath(path, preimage);
  for (const dependency of manifest.basis.work.dependencies) {
    if (dependency.kind === "semantic-resource") continue;
    await addBasisPath(dependency.key, dependency.digest);
  }

  const expectedFiles = new Set<string>();
  for (const [path, sourceDigest] of sourceDigests) {
    const operation = operations.get(path);
    if (operation?.kind === "delete") continue;
    if (operation?.kind === "write" || sourceDigest !== null) expectedFiles.add(path);
  }

  const requiredDirectories = new Set<string>();
  const addAncestors = (path: string) => {
    const parts = path.split("/");
    for (let index = 1; index < parts.length; index += 1) requiredDirectories.add(parts.slice(0, index).join("/"));
  };
  for (const [path, sourceDigest] of sourceDigests) if (sourceDigest !== null) addAncestors(path);
  for (const path of operations.keys()) addAncestors(path);
  const allowedDirectories = new Set([...requiredDirectories, ".usf-check-tmp"]);

  const actualFiles = new Set<string>();
  const actualDirectories = new Set<string>();
  async function inventory(repositoryPath = ""): Promise<void> {
    const target = repositoryPath === "" ? workspace : resolve(workspace, repositoryPath);
    const entry = await lstat(target);
    if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) {
      throw new RealisationError("CANDIDATE_BASIS_MISMATCH", `Workspace contains a non-regular entry: ${repositoryPath}`);
    }
    if (entry.isFile()) {
      actualFiles.add(repositoryPath);
      return;
    }
    if (repositoryPath !== "") actualDirectories.add(repositoryPath);
    const children = await readdir(target);
    await Promise.all(children.map((child) => inventory(repositoryPath === "" ? child : `${repositoryPath}/${child}`)));
  }

  await inventory();
  actualFiles.delete(manifestName);
  for (const path of actualDirectories) {
    if (!allowedDirectories.has(path)) throw new RealisationError("CANDIDATE_BASIS_MISMATCH", `Workspace has an extra unauthenticated directory: ${path}`);
  }
  for (const path of requiredDirectories) {
    if (!actualDirectories.has(path)) throw new RealisationError("CANDIDATE_BASIS_MISMATCH", `Workspace is missing a basis-bound directory: ${path}`);
  }
  for (const path of actualFiles) {
    if (!expectedFiles.has(path)) throw new RealisationError("CANDIDATE_BASIS_MISMATCH", `Workspace has an extra unauthenticated file: ${path}`);
  }
  for (const path of expectedFiles) {
    if (!actualFiles.has(path)) throw new RealisationError("CANDIDATE_BASIS_MISMATCH", `Workspace is missing a basis-bound file: ${path}`);
  }

  for (const [path, sourceDigest] of sourceDigests) {
    const bytes = await bytesAt(workspace, path);
    const operation = operations.get(path);
    if (operation?.kind === "write") {
      const expected = operation.encoding === "base64" ? Buffer.from(operation.content ?? "", "base64") : Buffer.from(operation.content ?? "");
      if (bytes === null || !bytes.equals(expected)) throw new RealisationError("CANDIDATE_BASIS_MISMATCH", `Workspace post-image does not match resolved operation: ${path}`);
    } else if (operation?.kind === "delete") {
      if (bytes !== null) throw new RealisationError("CANDIDATE_BASIS_MISMATCH", `Workspace deletion post-image is present: ${path}`);
    } else if ((bytes === null ? null : digest(bytes)) !== sourceDigest) {
      throw new RealisationError("CANDIDATE_BASIS_MISMATCH", `Workspace has an undeclared scoped effect: ${path}`);
    }
  }
}

export async function currentCandidateWorkspace(root: string, candidateDigest: string): Promise<{ readonly workspace: string; readonly basis: RealisationBasis }> {
  const canonicalRoot = await realpath(root);
  const workspace = workspaceFor(canonicalRoot, candidateDigest);
  const manifest = await loadManifest(canonicalRoot, workspace);
  const fullDigest = digestPattern.test(candidateDigest) ? candidateDigest : `sha256:${candidateDigest}`;
  if (manifest.digest !== fullDigest) throw new RealisationError("MISSING_WORKSPACE", "Workspace digest does not match its location");
  const basis = await currentBasis(canonicalRoot, manifest.basis);
  for (const [path, expected] of Object.entries(manifest.preimages)) {
    const actual = await bytesAt(canonicalRoot, path);
    if ((actual === null ? null : digest(actual)) !== expected) throw new RealisationError("STALE_RELEVANT_PREIMAGE", `Relevant pre-image is stale: ${path}`);
  }
  await assertWorkspaceCandidateBytes(canonicalRoot, workspace, manifest);
  return Object.freeze({ workspace, basis });
}

export * from "./basis.ts";
export * from "./transition.ts";

export function encodeBytes(text: string): string { return Buffer.from(text).toString("base64"); }

export const stableReason = (error: unknown): ReasonCode | null => error instanceof RealisationError ? error.reasonCode : null;
