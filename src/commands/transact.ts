import { constants as fsConstants } from "node:fs";
import { lstat, link, mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { relative, resolve, sep } from "node:path";
import { canonicalDigest } from "../core/canonical.ts";
import { exitCodes, UsfError, type ExitCode } from "../core/errors.ts";
import { loadSemanticGraph } from "../graph/index.ts";
import { checkIntegrity } from "../graph/integrity.ts";
import { parseStrictNQuads, type Quad } from "../graph/nquads.ts";
import { projectEconomics } from "../providers/economics-projection.ts";
import { readRuntimeAuthority } from "../graph/runtime-authority.ts";
import { acquirePrimaryMutationLock } from "../realisation/transition.ts";
import type { CommandResult } from "./dispatcher.ts";

/**
 * One bounded atomic semantic transaction.
 *
 * This is the V3 replacement for the nine-stage contribution chain. It keeps
 * every invariant that chain protected -- authorized mutation, explicit scope,
 * derived blast radius, deterministic postimage, validation, stale-preimage
 * detection, atomic application, provenance and recoverability -- and drops the
 * intermediate persistent identities, construction grants and publication
 * objects, because no second trust domain consumes them.
 */
const maximumProposalBytes = 4 * 1024 * 1024;
const maximumPendingBytes = 12 * 1024 * 1024;
const maximumOperations = 64;

/**
 * Fallback path prefixes used only when the corpus has not yet declared its
 * transaction authority. Graph authority is the source.
 */
const fallbackAuthorizedPathPrefixes: readonly string[] = Object.freeze([
  "graph/", "schemas/", "config/", "docs/",
]);

const graphFixtureDirectoryName = "fixtures";
const graphDirectoryName = "graph";

/**
 * The graph-source denominator of a transaction is its proposed POSTIMAGE, not
 * its preimage: discovery walks what already exists, and a transaction that
 * creates a graph source must have those bytes parsed and integrity-checked
 * too. Otherwise the guarantee that the resulting corpus satisfies every
 * invariant before any write holds for every source except the ones being
 * introduced.
 *
 * The earlier recursion repair fixed depth and left novelty open. Measured: a
 * transaction creating nine sources carrying 3611 quads reported the
 * pre-transaction corpus as its validated denominator and applied successfully,
 * and the two real defects in the created bytes were caught only by a later
 * `usf graph integrity` run.
 *
 * Fixtures stay excluded at any depth, for the same reason the gate excludes
 * them: synthetic test input in its own namespace carries known defects and is
 * deliberately outside the corpus.
 */
export function graphSourceDenominator(
  discovered: readonly string[],
  postimagePaths: readonly string[],
  deletedPaths: readonly string[] = [],
): readonly string[] {
  const relative = (paths: readonly string[]): readonly string[] => paths
    .filter((path) => path.startsWith(`${graphDirectoryName}/`) && path.endsWith(".nq"))
    .map((path) => path.slice(graphDirectoryName.length + 1))
    .filter((name) => !name.split("/").includes(graphFixtureDirectoryName));
  const created = relative(postimagePaths);
  const removed = new Set(relative(deletedPaths));
  // Existing, plus created, minus deleted. Omitting the subtraction would
  // validate a corpus containing a source the transaction is about to remove,
  // which is the same class of defect as omitting the addition: the reported
  // denominator would not be the resulting one.
  return Object.freeze([...new Set([...discovered, ...created])].filter((name) => !removed.has(name)).sort());
}

/**
 * Whether an integrity violation is this corpus's to answer for.
 *
 * A violation carrying no graph label is corpus-level rather than local to one
 * source, and `undeclared-type` reports exactly that way. Requiring a non-empty
 * label silently excused every one of them, so a transaction introducing an
 * undeclared type was accepted while the gate reported the same corpus as
 * non-conforming. Convention exemption is a property of one named graph's local
 * style and cannot excuse an unattributable structural violation.
 *
 * Measured at the basis this was written against: all 24 legacy violations
 * carry a named exempt graph and none carries an empty label, so treating an
 * empty label as owned introduces no false refusal.
 */
export function isOwnedIntegrityViolation(
  graph: string,
  conventionExemptGraphs: readonly string[],
): boolean {
  return graph.length === 0 || !conventionExemptGraphs.includes(graph);
}

export type OperationKind = "append-quads" | "write-file" | "delete-file" | "derive-economics-projection";

interface ProposedOperation {
  readonly kind: OperationKind;
  readonly path: string;
  /** append-quads: canonical N-Quads lines. write-file: exact content. */
  readonly content?: string;
  /** Expected digest of the path before the change; null asserts absence. */
  readonly preimageDigest: string | null;
}

interface Proposal {
  readonly intent: string;
  readonly operations: readonly ProposedOperation[];
  readonly declaredAffectedPaths: readonly string[];
}

/** An ignored, owner-private crash envelope. It is operational state, never proof. */
export interface PendingTransaction {
  readonly schema: "urn:usf:semantic-transaction-pending:1";
  readonly transactionDigest: string;
  readonly writeRoot: string;
  readonly targetRepository: string | null;
  readonly transaction: Record<string, unknown>;
  readonly images: readonly Readonly<{ path: string; preimage: string | null; postimage: string | null }>[];
}
export interface TransactTestHooks { readonly afterAppliedWrite?: (count: number) => void | Promise<void>; }

const digestPattern = /^sha256:[0-9a-f]{64}$/u;

function pendingPath(root: string, digest: string): string {
  return resolve(root, ".usf", "transactions", `${digest.slice("sha256:".length)}.pending.json`);
}

async function privateTransactionDirectory(root: string): Promise<string> {
  const directory = resolve(root, ".usf", "transactions");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await assertPrivateTransactionDirectory(root, directory);
  return directory;
}

async function assertPrivateTransactionDirectory(root: string, directory = resolve(root, ".usf", "transactions")): Promise<void> {
  await assertNoSymlinkPath(root, directory);
  for (const candidate of [resolve(root, ".usf"), directory]) {
    const entry = await lstat(candidate);
    if (!entry.isDirectory() || entry.isSymbolicLink() || (typeof process.getuid === "function" && entry.uid !== process.getuid()) || (entry.mode & 0o077) !== 0) {
      throw new UsfError("TRANSACT_PRIVATE_STATE_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "Transaction state must be an owner-private real directory.");
    }
  }
}

function serializedPrivateJson(value: unknown): string { return `${JSON.stringify(value, null, 1)}\n`; }

async function atomicPrivateJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    const handle = await open(temporary, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(serializedPrivateJson(value)); await handle.sync(); } finally { await handle.close(); }
    // link is the no-replace publication primitive: a preplanted receipt or
    // pending envelope is a conflict, never something this command overwrites.
    await link(temporary, path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "EEXIST") throw new UsfError("TRANSACT_DURABLE_STATE_EXISTS", exitCodes.INTEGRATION_CONFLICT, "A transaction durable state already exists.");
      throw error;
    });
  } finally { await rm(temporary, { force: true }); }
}

async function readOwnerPrivateRegular(path: string, maximumBytes = maximumPendingBytes): Promise<string> {
  const named = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (named === undefined) throw new UsfError("TRANSACT_RECOVERY_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "A required transaction state is absent.");
  if (!named.isFile() || named.isSymbolicLink() || named.nlink !== 1 || named.size > maximumBytes
    || (typeof process.getuid === "function" && named.uid !== process.getuid()) || (named.mode & 0o077) !== 0) {
    throw new UsfError("TRANSACT_RECOVERY_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "Transaction state is not an owner-private regular file.");
  }
  const handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1 || opened.size > maximumBytes || opened.dev !== named.dev || opened.ino !== named.ino
      || (typeof process.getuid === "function" && opened.uid !== process.getuid()) || (opened.mode & 0o077) !== 0) {
      throw new UsfError("TRANSACT_RECOVERY_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "Transaction state changed while it was opened.");
    }
    const bytes = await handle.readFile({ encoding: "utf8" });
    const after = await handle.stat();
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size) {
      throw new UsfError("TRANSACT_RECOVERY_REFUSED", exitCodes.CURRENTNESS_FAILURE, "Transaction state changed while it was read.");
    }
    return bytes;
  } finally { await handle.close(); }
}

async function existingReceiptMatches(path: string, pending: PendingTransaction): Promise<boolean> {
  try {
    const value = JSON.parse(await readOwnerPrivateRegular(path)) as Record<string, unknown>;
    const { appliedAt, nonClaims, recovered, ...transactionBody } = value;
    return typeof appliedAt === "string" && value.transactionDigest === pending.transactionDigest
      && canonicalDigest(transactionBody) === canonicalDigest(pending.transaction)
      && (nonClaims === undefined || Array.isArray(nonClaims))
      && (recovered === undefined || recovered === true);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    if (error instanceof UsfError && error.code === "TRANSACT_RECOVERY_REFUSED") return false;
    throw error;
  }
}

async function acquireTransactionLocks(canonicalRoot: string, writeRoot: string): Promise<readonly Awaited<ReturnType<typeof acquirePrimaryMutationLock>>[]> {
  const locks: Awaited<ReturnType<typeof acquirePrimaryMutationLock>>[] = [];
  try {
    for (const root of [...new Set([canonicalRoot, writeRoot])].sort()) locks.push(await acquirePrimaryMutationLock(root));
    return locks;
  } catch (error) {
    await Promise.allSettled(locks.map(async ({ handle }) => handle.close()));
    throw error;
  }
}

async function releaseTransactionLocks(locks: readonly Awaited<ReturnType<typeof acquirePrimaryMutationLock>>[]): Promise<void> {
  await Promise.allSettled(locks.map(async ({ handle }) => handle.close()));
}

async function assertNoSymlinkPath(root: string, target: string): Promise<void> {
  if (!contained(root, target)) throw new UsfError("TRANSACT_RECOVERY_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "A recovery path escapes its root.");
  let cursor = root;
  for (const part of relative(root, target).split(sep)) {
    cursor = resolve(cursor, part);
    const entry = await lstat(cursor).catch(() => undefined);
    if (entry?.isSymbolicLink()) throw new UsfError("TRANSACT_RECOVERY_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "A recovery path crosses a symbolic link.");
  }
}

function validRelativePath(path: unknown): path is string {
  return typeof path === "string" && /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/u.test(path);
}

function parsePending(value: unknown, canonicalRoot: string, digest: string, expectedWriteRoot: string): PendingTransaction {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid("A pending transaction is not an object.");
  const record = value as Record<string, unknown>;
  if (record.schema !== "urn:usf:semantic-transaction-pending:1" || record.transactionDigest !== digest
    || record.writeRoot !== expectedWriteRoot || !digestPattern.test(digest) || typeof record.transaction !== "object" || record.transaction === null
    || !Array.isArray(record.images)) invalid("A pending transaction is malformed.");
  const transaction = record.transaction as Record<string, unknown>;
  const { transactionDigest: nestedDigest, ...transactionDraft } = transaction;
  if (nestedDigest !== digest || canonicalDigest(transactionDraft) !== digest || transaction.targetRepository !== record.targetRepository
    || !Array.isArray(transaction.derivedAffectedPaths) || !Array.isArray(transaction.preimages) || !Array.isArray(transaction.postimages)
    || !Array.isArray(transaction.deletions)) invalid("A pending transaction identity is not exact.");
  const paths = transaction.derivedAffectedPaths;
  if (paths.some((path) => !validRelativePath(path)) || [...paths].join("\u0000") !== [...paths].sort().join("\u0000")) invalid("A pending transaction paths are not canonical.");
  const preimageDigests = new Map((transaction.preimages as unknown[]).map((entry) => {
    if (typeof entry !== "object" || entry === null || typeof (entry as Record<string, unknown>).path !== "string") invalid("A pending preimage is malformed.");
    const item = entry as Record<string, unknown>; return [item.path as string, item.preimageDigest] as const;
  }));
  const postimageDigests = new Map((transaction.postimages as unknown[]).map((entry) => {
    if (typeof entry !== "object" || entry === null || typeof (entry as Record<string, unknown>).path !== "string") invalid("A pending postimage is malformed.");
    const item = entry as Record<string, unknown>; return [item.path as string, item.postimageDigest] as const;
  }));
  const deleted = new Set(transaction.deletions as unknown[]);
  const images = record.images.map((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) invalid("A pending transaction image is malformed.");
    const image = entry as Record<string, unknown>;
    if (!validRelativePath(image.path) || image.path !== paths[index] || (image.preimage !== null && typeof image.preimage !== "string")
      || (image.postimage !== null && typeof image.postimage !== "string")) invalid("A pending transaction image is invalid.");
    if (!contained(expectedWriteRoot, resolve(expectedWriteRoot, image.path))) invalid("A pending transaction image escapes its write root.");
    if (preimageDigests.get(image.path) !== (image.preimage === null ? null : canonicalDigest(image.preimage))
      || (deleted.has(image.path) ? image.postimage !== null : postimageDigests.get(image.path) !== (image.postimage === null ? null : canonicalDigest(image.postimage)))) {
      invalid("A pending transaction image does not match its signed transaction.");
    }
    return Object.freeze({ path: image.path, preimage: image.preimage as string | null, postimage: image.postimage as string | null });
  });
  if (images.length === 0 || images.length !== paths.length || new Set(images.map(({ path }) => path)).size !== images.length) invalid("A pending transaction image set is invalid.");
  return Object.freeze({ schema: record.schema, transactionDigest: digest, writeRoot: expectedWriteRoot,
    targetRepository: typeof record.targetRepository === "string" ? record.targetRepository : null,
    transaction, images: Object.freeze(images) });
}

/** Lists pending crash envelopes without treating them as completion evidence. */
export async function listPendingTransactions(repositoryRoot: string): Promise<readonly string[]> {
  const root = resolve(repositoryRoot);
  const directory = resolve(root, ".usf", "transactions");
  try { await assertPrivateTransactionDirectory(root, directory); }
  catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return Object.freeze([]);
    if (error instanceof UsfError) throw error;
    throw new UsfError("TRANSACT_PENDING_STATE_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "Transaction pending state is unsafe.");
  }
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return Object.freeze([]);
    throw new UsfError("TRANSACT_PENDING_STATE_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "Transaction pending state cannot be inspected.");
  }
  const pending = entries.filter((entry) => /^[0-9a-f]{64}\.pending\.json$/u.test(entry.name));
  for (const entry of pending) {
    const named = await lstat(resolve(directory, entry.name));
    if (!entry.isFile() || named.isSymbolicLink() || !named.isFile() || named.nlink !== 1
      || (typeof process.getuid === "function" && named.uid !== process.getuid()) || (named.mode & 0o077) !== 0) {
      throw new UsfError("TRANSACT_PENDING_STATE_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "A pending transaction state is unsafe.");
    }
  }
  return Object.freeze(pending.map((entry) => `sha256:${entry.name.slice(0, 64)}`).sort());
}

/**
 * Finish a fully-written transaction or roll back an exact partial postimage.
 * Unknown bytes, aliases and live primary-lock contention refuse; recovery is
 * intentionally not a best-effort repair mechanism.
 */
export async function recoverTransaction(repositoryRoot: string, transactionDigest: string, expectedWriteRoot = resolve(repositoryRoot)): Promise<{
  readonly outcome: "finished" | "rolled-back";
  readonly transactionDigest: string;
}> {
  const canonicalRoot = resolve(repositoryRoot);
  if (!digestPattern.test(transactionDigest) || resolve(expectedWriteRoot) !== expectedWriteRoot) invalid("A recovery requires one canonical transaction digest and write root.");
  const locks = await acquireTransactionLocks(canonicalRoot, expectedWriteRoot);
  try {
  await privateTransactionDirectory(canonicalRoot);
  const path = pendingPath(canonicalRoot, transactionDigest);
  await assertNoSymlinkPath(canonicalRoot, path);
  let pending: PendingTransaction;
  try { pending = parsePending(JSON.parse(await readOwnerPrivateRegular(path)), canonicalRoot, transactionDigest, expectedWriteRoot); }
  catch (error) {
    if (error instanceof UsfError) throw error;
    throw new UsfError("TRANSACT_RECOVERY_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "A pending transaction is not valid JSON.");
  }
    await Promise.all(pending.images.map(({ path: imagePath }) => assertNoSymlinkPath(expectedWriteRoot, resolve(expectedWriteRoot, imagePath))));
    const current = await Promise.all(pending.images.map(async (image) => readTargetOrAbsent(resolve(expectedWriteRoot, image.path))));
    if (current.some((bytes, index) => bytes !== pending.images[index]!.preimage && bytes !== pending.images[index]!.postimage)) {
      throw new UsfError("TRANSACT_RECOVERY_REFUSED", exitCodes.CURRENTNESS_FAILURE, "A pending transaction path has unknown bytes.");
    }
    const allPost = current.every((bytes, index) => bytes === pending.images[index]!.postimage);
    if (allPost) {
      const receiptPath = resolve(canonicalRoot, ".usf", "transactions", `${transactionDigest.slice("sha256:".length)}.json`);
      if (!await existingReceiptMatches(receiptPath, pending)) {
        const evidence = Object.freeze({ ...pending.transaction, appliedAt: new Date().toISOString(), recovered: true });
        await atomicPrivateJson(receiptPath, evidence);
      }
      await rm(path, { force: true });
      return { outcome: "finished", transactionDigest };
    }
    for (const image of pending.images) {
      const target = resolve(expectedWriteRoot, image.path);
      if (image.preimage === null) await rm(target, { force: true });
      else { await mkdir(dirname(target), { recursive: true, mode: 0o755 }); await atomicWriteTarget(expectedWriteRoot, target, image.preimage); }
    }
    await rm(path, { force: true });
    return { outcome: "rolled-back", transactionDigest };
  } finally { await releaseTransactionLocks(locks); }
}

function invalid(message: string, details?: Record<string, unknown>): never {
  throw new UsfError("TRANSACT_PROPOSAL_INVALID", exitCodes.INVALID_INPUT, message, details);
}

function contained(root: string, path: string): boolean {
  const relation = relative(root, path);
  return relation !== "" && relation !== ".." && !relation.startsWith(`..${sep}`);
}

function parseProposal(value: unknown): Proposal {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid("A proposal must be one JSON object.");
  const record = value as Record<string, unknown>;
  if (record.schema !== "urn:usf:semantic-transaction-proposal:1") invalid("Unknown proposal schema.");
  if (typeof record.intent !== "string" || record.intent.trim().length === 0) invalid("A proposal must state its intent.");
  const operations = record.operations;
  const declared = record.declaredAffectedPaths;
  if (!Array.isArray(operations) || operations.length === 0 || operations.length > maximumOperations) {
    invalid("A proposal must carry between one and sixty-four operations.");
  }
  if (!Array.isArray(declared) || declared.some((entry) => typeof entry !== "string")) {
    invalid("A proposal must declare its affected paths.");
  }
  const parsed = operations.map((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) invalid("Each operation must be an object.");
    const operation = entry as Record<string, unknown>;
    const kind = operation.kind;
    const path = operation.path;
    if (kind !== "append-quads" && kind !== "write-file" && kind !== "delete-file" && kind !== "derive-economics-projection") {
      invalid("Unknown operation kind.", { kind });
    }
    if (typeof path !== "string" || path.length === 0 || path.startsWith("/") || path.includes("..")) {
      invalid("An operation path must be a repository-relative path.", { path });
    }
    if (kind !== "derive-economics-projection" && kind !== "delete-file" && typeof operation.content !== "string") {
      invalid("This operation kind requires content.", { kind, path });
    }
    if (kind === "delete-file" && operation.content !== undefined) {
      invalid("A delete carries no content.", { kind, path });
    }
    const preimage = operation.preimageDigest;
    if (preimage !== null && typeof preimage !== "string") invalid("preimageDigest must be a digest or null.", { path });
    // A deletion must name what it expects to remove. A null preimage asserts
    // absence, and deleting something already absent is not a change: it is a
    // proposal that has lost track of the state it was derived against.
    if (kind === "delete-file" && preimage === null) {
      invalid("A delete requires the preimage digest of the path it removes.", { kind, path });
    }
    return Object.freeze({
      kind, path,
      content: typeof operation.content === "string" ? operation.content : undefined,
      preimageDigest: (preimage ?? null) as string | null,
    });
  });
  return Object.freeze({
    intent: record.intent,
    operations: Object.freeze(parsed),
    declaredAffectedPaths: Object.freeze([...new Set(declared as string[])].sort()),
  });
}

async function fileDigest(absolute: string): Promise<string | null> {
  const named = await lstat(absolute).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (named === undefined) return null;
  if (!named.isFile() || named.isSymbolicLink() || named.nlink !== 1) {
    throw new UsfError("TRANSACT_PATH_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "A transaction target is not a regular unlinked file.");
  }
  const bytes = await readFile(absolute, "utf8");
  return canonicalDigest(bytes);
}

async function readTargetOrAbsent(absolute: string): Promise<string | null> {
  const named = await lstat(absolute).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (named === undefined) return null;
  if (!named.isFile() || named.isSymbolicLink() || named.nlink !== 1) {
    throw new UsfError("TRANSACT_PATH_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "A transaction target is unsafe.");
  }
  return readFile(absolute, "utf8");
}

async function atomicWriteTarget(root: string, absolute: string, content: string): Promise<void> {
  await assertNoSymlinkPath(root, dirname(absolute));
  const temporary = resolve(dirname(absolute), `.${process.pid}.${Math.random().toString(16).slice(2)}.transact.tmp`);
  const handle = await open(temporary, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW, 0o644);
  try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
  try { await rename(temporary, absolute); } finally { await rm(temporary, { force: true }); }
}

/** Merge appended quads into a graph file, sorted and duplicate-free. */
function mergeQuadFile(existing: string, appended: string): string {
  const lines = new Set([
    ...existing.split("\n").filter((line) => line.trim().length > 0),
    ...appended.split("\n").filter((line) => line.trim().length > 0),
  ]);
  return `${[...lines].sort().join("\n")}\n`;
}

function mutationBasis(value: Record<string, unknown>): string {
  const validation = value.validation as Record<string, unknown> | undefined;
  return canonicalDigest({ proposalDigest: value.proposalDigest, targetRepository: value.targetRepository,
    derivedAffectedPaths: value.derivedAffectedPaths, preimages: value.preimages, postimages: value.postimages,
    deletions: value.deletions, targetRepositoryRootDigest: value.targetRepositoryRootDigest,
    validation: validation === undefined ? undefined : { conforming: validation.conforming, pathAuthorityFromGraph: validation.pathAuthorityFromGraph,
      authorizedPathPrefixes: validation.authorizedPathPrefixes } });
}

export async function transactCommand(repositoryRoot: string, args: readonly string[], testHooks?: TransactTestHooks): Promise<CommandResult> {
  const values = new Map<string, string>();
  let dryRun = false;
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index]!;
    if (option === "--dry-run") { dryRun = true; continue; }
    if (!["--proposal", "--recover", "--repository", "--manifest"].includes(option) || values.has(option)) {
      invalid(`Unknown or repeated option: ${option}`);
    }
    const value = args[++index];
    if (value === undefined || value.startsWith("--")) invalid("Missing value for --proposal.");
    values.set(option, value);
  }
  const proposalPath = values.get("--proposal");
  const recoveryDigest = values.get("--recover");
  if ((proposalPath === undefined) === (recoveryDigest === undefined)) invalid("A transaction requires exactly one of --proposal or --recover.");
  if (recoveryDigest !== undefined && dryRun) invalid("Recovery cannot be combined with --dry-run.");

  // ---- 1. propose -----------------------------------------------------------
  const canonicalRoot = resolve(repositoryRoot);
  if (recoveryDigest !== undefined && values.get("--repository") === undefined) {
    const recovered = await recoverTransaction(canonicalRoot, recoveryDigest, canonicalRoot);
    return { output: Object.freeze({ schema: "urn:usf:semantic-transaction-recovery:1", ...recovered, targetRepository: null }), exitCode: exitCodes.SUCCESS as ExitCode };
  }
  // ---- 2. derive affected closure ------------------------------------------
  // Read the authority that governs this transaction from the current corpus.
  const currentGraph = loadSemanticGraph(repositoryRoot, "graph/manifests/v3-convention.json");
  const runtimeAuthority = readRuntimeAuthority(currentGraph.quads);

  // A transaction may target a declared product repository instead of USF
  // itself. USF is the foundation; a product is realised into its own
  // repository, and writing there must not mean weakening the containment that
  // keeps USF from writing anywhere else. So the write root moves to the
  // authenticated product root and the product's own prefixes replace USF's --
  // they are never combined, because USF's prefixes describe USF's layout and
  // say nothing about a product's.
  const repositoryIri = values.get("--repository");
  let writeRoot = canonicalRoot;
  let targetRepository: string | null = null;
  let authorizedPathPrefixes = runtimeAuthority.authorizedPathPrefixes.length > 0
    ? runtimeAuthority.authorizedPathPrefixes
    : fallbackAuthorizedPathPrefixes;
  if (repositoryIri !== undefined) {
    const productManifest = values.get("--manifest");
    if (productManifest === undefined) invalid("A repository-targeted transaction requires --manifest declaring it.");
    const { authenticateProductRepositoryRoot, readProductRepositories } =
      await import("../core/product-repository.ts");
    const declared = readProductRepositories(loadSemanticGraph(repositoryRoot, productManifest))
      .find((entry) => entry.repository === repositoryIri);
    if (declared === undefined) {
      throw new UsfError("TRANSACT_REPOSITORY_UNKNOWN", exitCodes.INVALID_INPUT,
        "The manifest declares no such product repository.", { repository: repositoryIri });
    }
    if (declared.authorizedPathPrefixes.length === 0) {
      throw new UsfError("TRANSACT_REPOSITORY_UNAUTHORIZED", exitCodes.CONTAINMENT_REFUSAL,
        "A product repository must declare the prefixes it permits before anything may be written into it.",
        { repository: repositoryIri });
    }
    writeRoot = await authenticateProductRepositoryRoot(repositoryRoot, declared);
    authorizedPathPrefixes = declared.authorizedPathPrefixes;
    targetRepository = declared.repository;
  }

  if (recoveryDigest !== undefined) {
    const recovered = await recoverTransaction(canonicalRoot, recoveryDigest, writeRoot);
    return { output: Object.freeze({ schema: "urn:usf:semantic-transaction-recovery:1", ...recovered, targetRepository }), exitCode: exitCodes.SUCCESS as ExitCode };
  }

  const absoluteProposal = resolve(canonicalRoot, proposalPath!);
  if (!contained(canonicalRoot, absoluteProposal)) {
    throw new UsfError("TRANSACT_PROPOSAL_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The proposal resolves outside the repository.");
  }
  const proposalBytes = await readFile(absoluteProposal).catch(() => undefined);
  if (proposalBytes === undefined || proposalBytes.length > maximumProposalBytes) {
    throw new UsfError("TRANSACT_PROPOSAL_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The proposal must be one bounded readable file.");
  }
  let proposal: Proposal;
  try { proposal = parseProposal(JSON.parse(proposalBytes.toString("utf8")) as unknown); }
  catch (error) { if (error instanceof UsfError) throw error; invalid("The proposal is not valid UTF-8 JSON."); }
  const proposalDigest = canonicalDigest(proposalBytes.toString("utf8"));

  const derivedPaths = Object.freeze([...new Set(proposal.operations.map((operation) => operation.path))].sort());
  const undeclared = derivedPaths.filter((path) => !proposal.declaredAffectedPaths.includes(path));
  const overdeclared = proposal.declaredAffectedPaths.filter((path) => !derivedPaths.includes(path));
  const unauthorized = derivedPaths.filter(
    (path) => !authorizedPathPrefixes.some((prefix) => path.startsWith(prefix)),
  );
  if (unauthorized.length > 0) {
    throw new UsfError("TRANSACT_UNAUTHORIZED_PATH", exitCodes.CONTAINMENT_REFUSAL,
      "A transaction may only write paths the transaction authority permits.",
      { unauthorized, authorizedPathPrefixes });
  }
  if (undeclared.length > 0) {
    throw new UsfError("TRANSACT_UNDECLARED_EFFECT", exitCodes.DOMAIN_FAILURE,
      "The proposal writes paths it did not declare.", { undeclared });
  }

  const preimages: Array<Readonly<{ path: string; digest: string | null; bytes: string | null }>> = [];
  let capturedBytes = 0;
  for (const path of derivedPaths) {
    const absolute = resolve(writeRoot, path);
    if (!contained(writeRoot, absolute)) {
      throw new UsfError("TRANSACT_PATH_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "An operation path escapes the repository.", { path });
    }
    await assertNoSymlinkPath(writeRoot, absolute);
    const entry = await lstat(absolute).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (entry !== undefined && (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1 || entry.size > maximumPendingBytes)) {
      throw new UsfError("TRANSACT_PATH_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "A transaction preimage is unsafe or exceeds the recovery bound.", { path });
    }
    capturedBytes += entry?.size ?? 0;
    if (capturedBytes > maximumPendingBytes) {
      throw new UsfError("TRANSACT_PENDING_TOO_LARGE", exitCodes.CONTAINMENT_REFUSAL, "Transaction preimages exceed the recovery envelope bound.");
    }
    const bytes = entry === undefined ? null : await readFile(absolute, "utf8");
    preimages.push(Object.freeze({ path, digest: bytes === null ? null : canonicalDigest(bytes), bytes }));
  }
  const preimageByPath = new Map(preimages.map((entry) => [entry.path, entry] as const));

  // Stale preimage: the proposal was derived against a state that has moved.
  const stale = proposal.operations.filter((operation) => {
    const preimage = preimageByPath.get(operation.path)!;
    return operation.preimageDigest !== preimage.digest;
  }).map((operation) => Object.freeze({
    path: operation.path,
    expected: operation.preimageDigest,
    actual: preimageByPath.get(operation.path)!.digest,
  }));
  if (stale.length > 0) {
    throw new UsfError("TRANSACT_STALE_PREIMAGE", exitCodes.CURRENTNESS_FAILURE,
      "The proposal was derived against a state that has since changed.", { stale });
  }

  // ---- 3. validate ----------------------------------------------------------
  // Compute every postimage in memory first; nothing is written until the whole
  // resulting state validates.
  const postimages = new Map<string, string>();
  const deletions = new Set<string>();
  for (const operation of proposal.operations) {
    const preimage = preimageByPath.get(operation.path)!;
    if (operation.kind === "append-quads") {
      postimages.set(operation.path, mergeQuadFile(postimages.get(operation.path) ?? preimage.bytes ?? "", operation.content!));
      deletions.delete(operation.path);
    } else if (operation.kind === "write-file") {
      postimages.set(operation.path, operation.content!);
      deletions.delete(operation.path);
    } else if (operation.kind === "delete-file") {
      // The last operation on a path wins, so a write followed by a delete is a
      // delete. Removing it from postimages is what makes the validated corpus
      // below the corpus that will exist, rather than the corpus plus a file
      // that is about to go.
      postimages.delete(operation.path);
      deletions.add(operation.path);
    }
  }

  // Graph postimages must parse and the resulting corpus must satisfy integrity.
  const graphDirectory = resolve(canonicalRoot, "graph");
  // Recursive, so a product-overlay postimage is parsed and the resulting
  // corpus that integrity sees is the whole corpus. A non-recursive read
  // validated 14 of 21 sources and would have let a transaction write an
  // overlay path without ever checking the bytes it produced. Fixtures are
  // synthetic test input and are excluded here for the same reason the gate
  // excludes them.
  const discovered = await (async function walk(dir: string, prefix: string): Promise<readonly string[]> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const found: string[] = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name === graphFixtureDirectoryName) continue;
        found.push(...await walk(resolve(dir, entry.name), `${prefix}${entry.name}/`));
      } else if (entry.name.endsWith(".nq")) {
        found.push(`${prefix}${entry.name}`);
      }
    }
    return found;
  })(graphDirectory, "");
  const graphFiles = graphSourceDenominator(discovered, [...postimages.keys()], [...deletions]);
  const resultingQuads: Quad[] = [];
  for (const name of graphFiles) {
    const path = `graph/${name}`;
    const source = postimages.get(path) ?? await readFile(resolve(graphDirectory, name), "utf8").catch(() => undefined);
    if (source === undefined) continue;
    const firstLine = source.split("\n").find((line) => line.trim().length > 0) ?? "";
    const graph = /<([^>]+)> \.$/u.exec(firstLine)?.[1];
    if (graph === undefined) {
      throw new UsfError("TRANSACT_GRAPH_INVALID", exitCodes.DOMAIN_FAILURE, "A resulting graph file names no graph.", { path });
    }
    try { resultingQuads.push(...parseStrictNQuads(source, graph, 200_000)); }
    catch (error) {
      throw new UsfError("TRANSACT_GRAPH_INVALID", exitCodes.DOMAIN_FAILURE,
        "A resulting graph file is not valid blank-node-free N-Quads.",
        { path, reasonCode: error instanceof Error ? error.message : "NQUADS_INVALID" });
    }
  }
  // Scopes are read from the resulting corpus, so a transaction that changes a
  // scope is validated against the scope it establishes.
  const { conventionExemptGraphs, stateReasonGraphs, derivedOnlyTypes, functionalPredicates } = await import("./graph-integrity.ts")
    .then((module) => module.integrityScopes(resultingQuads));
  const integrity = checkIntegrity(resultingQuads, { conventionExemptGraphs, stateReasonGraphs, derivedOnlyTypes, functionalPredicates });
  const ownedViolations = integrity.violations.filter(
    (violation) => isOwnedIntegrityViolation(violation.graph, conventionExemptGraphs),
  );
  if (ownedViolations.length > 0) {
    throw new UsfError("TRANSACT_INTEGRITY_VIOLATION", exitCodes.DOMAIN_FAILURE,
      "The resulting corpus violates a semantic integrity invariant.",
      { violations: ownedViolations.slice(0, 8) });
  }

  // Derived projections are computed from the resulting graph, never authored.
  const derivations: Array<Readonly<{ path: string; sourceGraphDigest: string }>> = [];
  for (const operation of proposal.operations) {
    if (operation.kind !== "derive-economics-projection") continue;
    const staged = resolve(canonicalRoot, ".usf", "transactions", "staged-graph");
    await rm(staged, { recursive: true, force: true });
    await mkdir(staged, { recursive: true, mode: 0o700 });
    // Project from the resulting graph state, not the current one.
    const projectionGraph = Object.freeze({ quads: Object.freeze(resultingQuads) }) as never;
    let projected;
    try {
      projected = projectEconomics(projectionGraph);
    } catch (error) {
      throw new UsfError("TRANSACT_DERIVATION_FAILED", exitCodes.DOMAIN_FAILURE,
        "A derived projection could not be computed from the resulting graph.",
        { path: operation.path, reasonCode: error instanceof Error ? error.message : "UNKNOWN" });
    }
    postimages.set(operation.path, `${JSON.stringify(projected, null, 2)}\n`);
    derivations.push(Object.freeze({ path: operation.path, sourceGraphDigest: projected.sourceGraphDigest }));
  }

  const postimageRecords = Object.freeze([...postimages.entries()]
    .map(([path, content]) => Object.freeze({ path, postimageDigest: canonicalDigest(content) }))
    .sort((left, right) => left.path.localeCompare(right.path)));

  const transaction = Object.freeze({
    schema: "urn:usf:semantic-transaction:1" as const,
    version: 1 as const,
    intent: proposal.intent,
    proposalDigest,
    operations: Object.freeze(proposal.operations.map((operation) => Object.freeze({
      kind: operation.kind, path: operation.path,
      contentDigest: operation.content === undefined ? null : canonicalDigest(operation.content),
    }))),
    declaredAffectedPaths: proposal.declaredAffectedPaths,
    derivedAffectedPaths: derivedPaths,
    overdeclaredPaths: Object.freeze(overdeclared),
    preimages: Object.freeze(preimages.map((entry) => Object.freeze({ path: entry.path, preimageDigest: entry.digest }))),
    deletions: Object.freeze([...deletions].sort()),
    postimages: postimageRecords,
    derivations: Object.freeze(derivations),
    validation: Object.freeze({
      graphFilesParsed: graphFiles.length,
      resultingQuadCount: resultingQuads.length,
      integrityInvariantCount: integrity.checkedCodes.length,
      ownedGraphViolationCount: ownedViolations.length,
      conforming: true,
      pathAuthorityFromGraph: runtimeAuthority.authorizedPathPrefixes.length > 0,
      authorizedPathPrefixes,
    }),
    applied: !dryRun,
    targetRepository,
    targetRepositoryRootDigest: canonicalDigest(writeRoot),
  });
  const transactionDigest = canonicalDigest(transaction);

  if (dryRun) {
    return { output: Object.freeze({ ...transaction, transactionDigest }), exitCode: exitCodes.SUCCESS as ExitCode };
  }

  const unresolved = await listPendingTransactions(canonicalRoot);
  if (unresolved.length > 0) {
    throw new UsfError("TRANSACT_PENDING_RECOVERY", exitCodes.INTEGRATION_CONFLICT,
      "A prior semantic transaction requires explicit recovery before another may mutate.", { transactions: unresolved });
  }

  // ---- 4. apply atomically --------------------------------------------------
  // Validation stays outside the lock; primary mutation does not.  The final
  // currentness check, write, rollback and durable receipt are one exclusion
  // interval. Product writes acquire both roots in deterministic order.
  const locks = await acquireTransactionLocks(canonicalRoot, writeRoot);
  const scratch = resolve(canonicalRoot, ".usf", "transactions", transactionDigest.slice("sha256:".length));
  const staged: Array<Readonly<{ path: string; temporary: string }>> = [];
  let mutationStarted = false;
  let appliedWrites = 0;
  let receiptWritten = false;
  let pending: PendingTransaction | null = null;
  try {
    const pendingInsideLock = await listPendingTransactions(canonicalRoot);
    if (pendingInsideLock.length > 0) {
      throw new UsfError("TRANSACT_PENDING_RECOVERY", exitCodes.INTEGRATION_CONFLICT,
        "A prior semantic transaction requires explicit recovery before another may mutate.", { transactions: pendingInsideLock });
    }
    const evidenceDirectory = await privateTransactionDirectory(canonicalRoot);
    // Repeat the implemented proposal pipeline at the actual mutation
    // boundary. This rereads authority, authenticated product location and the
    // whole resulting graph without treating unrelated valid movement as stale.
    const refreshArguments = ["--proposal", proposalPath!, "--dry-run",
      ...(repositoryIri === undefined ? [] : ["--repository", repositoryIri, "--manifest", values.get("--manifest")!])];
    const refreshed = await transactCommand(repositoryRoot, refreshArguments) as { output: Record<string, unknown> };
    if (mutationBasis(refreshed.output) !== mutationBasis(transaction as unknown as Record<string, unknown>)) {
      throw new UsfError("TRANSACT_CURRENTNESS_CHANGED", exitCodes.CURRENTNESS_FAILURE,
        "Transaction authority, target identity or affected postimage changed while awaiting mutation.");
    }
    await mkdir(scratch, { recursive: true, mode: 0o700 });
    let index = 0;
    for (const [path, content] of [...postimages.entries()].sort()) {
      const temporary = resolve(scratch, `staged-${index}`);
      index += 1;
      await writeFile(temporary, content, { mode: 0o644 });
      staged.push(Object.freeze({ path, temporary }));
    }
    // Re-prove every preimage immediately before the first mutation.
    for (const entry of preimages) {
      const current = await fileDigest(resolve(writeRoot, entry.path));
      if (current !== entry.digest) {
        throw new UsfError("TRANSACT_STALE_PREIMAGE", exitCodes.CURRENTNESS_FAILURE,
          "A path changed between validation and application.", { path: entry.path });
      }
    }
    pending = Object.freeze({
      schema: "urn:usf:semantic-transaction-pending:1" as const,
      transactionDigest,
      writeRoot,
      targetRepository,
      transaction: Object.freeze({ ...transaction, transactionDigest }),
      images: Object.freeze(derivedPaths.map((path) => Object.freeze({
        path,
        preimage: preimageByPath.get(path)!.bytes,
        postimage: deletions.has(path) ? null : postimages.get(path)!,
      }))),
    });
    if (Buffer.byteLength(serializedPrivateJson(pending), "utf8") > maximumPendingBytes) {
      throw new UsfError("TRANSACT_PENDING_TOO_LARGE", exitCodes.CONTAINMENT_REFUSAL, "The recoverable transaction envelope exceeds its bounded limit.");
    }
    // Persist before the first mutation. The recovery path accepts only these
    // exact reversible images and holds the same locks.
    await atomicPrivateJson(pendingPath(canonicalRoot, transactionDigest), pending);
    for (const entry of staged) {
      const target = resolve(writeRoot, entry.path);
      // A realized artefact may be the first file in its canonical directory.
      // The directory is part of the declared path, not a separate effect.
      await mkdir(dirname(target), { recursive: true, mode: 0o755 });
      mutationStarted = true;
      await rename(entry.temporary, target);
      appliedWrites += 1;
      await testHooks?.afterAppliedWrite?.(appliedWrites);
    }
    // Deletions land after the writes, so a move never passes through a state
    // where neither copy exists. Both are inside the same rollback, and the
    // captured preimage bytes restore a deleted file exactly.
    for (const path of [...deletions].sort()) {
      mutationStarted = true;
      await rm(resolve(writeRoot, path), { force: true });
    }
    const evidence = Object.freeze({
      ...transaction,
      transactionDigest,
      appliedAt: new Date().toISOString(),
      nonClaims: Object.freeze([
        "This record proves that exactly the declared paths moved from the recorded preimages to the recorded postimages, and that the resulting corpus satisfied the integrity invariants.",
        "No construction grant, publication object or intermediate persistent identity was created; the transaction identity is the digest of its own content.",
        "Git is the carrier of the resulting bytes, not the identity of this transaction.",
      ]),
    });
    // Receipt precedes pending removal while the lock is held. A process death
    // between them leaves a deterministically finishable pending envelope.
    await atomicPrivateJson(resolve(evidenceDirectory, `${transactionDigest.slice("sha256:".length)}.json`), evidence);
    receiptWritten = true;
    await rm(pendingPath(canonicalRoot, transactionDigest), { force: true });
    return { output: evidence, exitCode: exitCodes.SUCCESS as ExitCode };
  } catch (error) {
    // Never restore after a stale check before any mutation. Once mutation did
    // begin, restore only if no writer introduced bytes outside this exact
    // envelope; otherwise leave pending for an explicit fail-closed recovery.
    if (!receiptWritten && mutationStarted && pending !== null) {
      const known = await Promise.all(pending.images.map(async (image) => {
        const actual = await readTargetOrAbsent(resolve(writeRoot, image.path));
        return actual === image.preimage || actual === image.postimage;
      }));
      if (known.every(Boolean)) {
        for (const image of pending.images) {
          const absolute = resolve(writeRoot, image.path);
          if (image.preimage === null) await rm(absolute, { force: true });
          else { await mkdir(dirname(absolute), { recursive: true, mode: 0o755 }); await atomicWriteTarget(writeRoot, absolute, image.preimage); }
        }
        await rm(pendingPath(canonicalRoot, transactionDigest), { force: true });
      }
    }
    throw error;
  } finally {
    await rm(scratch, { recursive: true, force: true });
    await releaseTransactionLocks(locks);
  }
}
