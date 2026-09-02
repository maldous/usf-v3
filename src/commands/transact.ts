import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { relative, resolve, sep } from "node:path";
import { canonicalDigest } from "../core/canonical.ts";
import { exitCodes, UsfError, type ExitCode } from "../core/errors.ts";
import { loadSemanticGraph } from "../graph/index.ts";
import { checkIntegrity } from "../graph/integrity.ts";
import { parseStrictNQuads, type Quad } from "../graph/nquads.ts";
import { projectEconomics } from "../providers/economics-projection.ts";
import { readRuntimeAuthority } from "../graph/runtime-authority.ts";
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
const maximumOperations = 64;

/**
 * Fallback path prefixes used only when the corpus has not yet declared its
 * transaction authority. Graph authority is the source.
 */
const fallbackAuthorizedPathPrefixes: readonly string[] = Object.freeze([
  "graph/", "schemas/", "config/", "docs/",
]);

export type OperationKind = "append-quads" | "write-file" | "derive-economics-projection";

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
    if (kind !== "append-quads" && kind !== "write-file" && kind !== "derive-economics-projection") {
      invalid("Unknown operation kind.", { kind });
    }
    if (typeof path !== "string" || path.length === 0 || path.startsWith("/") || path.includes("..")) {
      invalid("An operation path must be a repository-relative path.", { path });
    }
    if (kind !== "derive-economics-projection" && typeof operation.content !== "string") {
      invalid("This operation kind requires content.", { kind, path });
    }
    const preimage = operation.preimageDigest;
    if (preimage !== null && typeof preimage !== "string") invalid("preimageDigest must be a digest or null.", { path });
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
  const bytes = await readFile(absolute).catch(() => undefined);
  return bytes === undefined ? null : canonicalDigest(bytes.toString("utf8"));
}

/** Merge appended quads into a graph file, sorted and duplicate-free. */
function mergeQuadFile(existing: string, appended: string): string {
  const lines = new Set([
    ...existing.split("\n").filter((line) => line.trim().length > 0),
    ...appended.split("\n").filter((line) => line.trim().length > 0),
  ]);
  return `${[...lines].sort().join("\n")}\n`;
}

export async function transactCommand(repositoryRoot: string, args: readonly string[]): Promise<CommandResult> {
  const values = new Map<string, string>();
  let dryRun = false;
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index]!;
    if (option === "--dry-run") { dryRun = true; continue; }
    if (!["--proposal", "--repository", "--manifest"].includes(option) || values.has(option)) {
      invalid(`Unknown or repeated option: ${option}`);
    }
    const value = args[++index];
    if (value === undefined || value.startsWith("--")) invalid("Missing value for --proposal.");
    values.set(option, value);
  }
  const proposalPath = values.get("--proposal");
  if (proposalPath === undefined) invalid("A transaction requires --proposal.");

  // ---- 1. propose -----------------------------------------------------------
  const canonicalRoot = resolve(repositoryRoot);
  const absoluteProposal = resolve(canonicalRoot, proposalPath);
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
  for (const path of derivedPaths) {
    const absolute = resolve(writeRoot, path);
    if (!contained(writeRoot, absolute)) {
      throw new UsfError("TRANSACT_PATH_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "An operation path escapes the repository.", { path });
    }
    const bytes = await readFile(absolute, "utf8").catch(() => null);
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
  for (const operation of proposal.operations) {
    const preimage = preimageByPath.get(operation.path)!;
    if (operation.kind === "append-quads") {
      postimages.set(operation.path, mergeQuadFile(postimages.get(operation.path) ?? preimage.bytes ?? "", operation.content!));
    } else if (operation.kind === "write-file") {
      postimages.set(operation.path, operation.content!);
    }
  }

  // Graph postimages must parse and the resulting corpus must satisfy integrity.
  const graphDirectory = resolve(canonicalRoot, "graph");
  const graphFiles = (await readdir(graphDirectory).catch(() => [] as string[])).filter((name) => name.endsWith(".nq")).sort();
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
    (violation) => violation.graph.length > 0 && !conventionExemptGraphs.includes(violation.graph),
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
  });
  const transactionDigest = canonicalDigest(transaction);

  if (dryRun) {
    return { output: Object.freeze({ ...transaction, transactionDigest }), exitCode: exitCodes.SUCCESS as ExitCode };
  }

  // ---- 4. apply atomically --------------------------------------------------
  const scratch = resolve(canonicalRoot, ".usf", "transactions", transactionDigest.slice("sha256:".length));
  await mkdir(scratch, { recursive: true, mode: 0o700 });
  const staged: Array<Readonly<{ path: string; temporary: string }>> = [];
  try {
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
    for (const entry of staged) {
      const target = resolve(writeRoot, entry.path);
      // A realized artefact may be the first file in its canonical directory.
      // The directory is part of the declared path, not a separate effect.
      await mkdir(dirname(target), { recursive: true, mode: 0o755 });
      await rename(entry.temporary, target);
    }
  } catch (error) {
    // Restore every captured preimage so a partial application cannot survive.
    for (const entry of preimages) {
      const absolute = resolve(writeRoot, entry.path);
      if (entry.bytes === null) await rm(absolute, { force: true });
      else await writeFile(absolute, entry.bytes, { mode: 0o644 });
    }
    throw error;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }

  // ---- 5. emit evidence -----------------------------------------------------
  const evidenceDirectory = resolve(canonicalRoot, ".usf", "transactions");
  await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
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
  await writeFile(
    resolve(evidenceDirectory, `${transactionDigest.slice("sha256:".length)}.json`),
    `${JSON.stringify(evidence, null, 1)}\n`,
    { mode: 0o600 },
  );
  return { output: evidence, exitCode: exitCodes.SUCCESS as ExitCode };
}
