import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalDigest, canonicalJson, sha256 } from "../core/canonical.ts";
import { isPathWithinPermission, isRepositoryRelativePath } from "../core/scope.ts";
import { loadSemanticGraph } from "../graph/index.ts";
import { deriveCliTransitionContext } from "../graph/cli-transitions.ts";
import { deriveWork, deriveCurrentRealisationBasis } from "../graph/work.ts";
import { assertSameBasis, parseRealisationBasis, type RealisationBasis } from "../realisation/basis.ts";
import { deriveCandidatePreimages } from "../realisation/index.ts";
import { immutable, isOperation, type FileOperation } from "../providers/types.ts";

export interface LocalContribution {
  readonly schema: "urn:usf:local-contribution:1";
  readonly kind: "local-contribution";
  readonly basis: RealisationBasis;
  readonly identity: { readonly artifactDigest: string; readonly basisDigest: string };
  readonly payload: { readonly operations: readonly FileOperation[] };
  readonly provenance: {
    readonly sourceKind: "local-authored"; readonly rootIdentity: string;
    readonly originalAuthor: null; readonly model: null; readonly tokens: null; readonly cost: null;
    readonly reviewIndependence: "unknown"; readonly toolDigest: string | null;
    readonly operationsDigest: string;
  };
}
export class LocalContributionError extends Error {
  readonly reasonCode: string;
  constructor(reasonCode: string) { super(reasonCode); this.name = "LocalContributionError"; this.reasonCode = reasonCode; }
}
function refuse(reason: string): never { throw new LocalContributionError(reason); }
function record(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.keys(value).some(k => !allowed.includes(k))) return refuse("LOCAL_CONTRIBUTION_INPUT_INVALID");
  return value as Record<string, unknown>;
}
const validDigest = (v: unknown): v is string => typeof v === "string" && /^sha256:[0-9a-f]{64}$/.test(v);
const localSource = "urn:usf:contribution-source:local-authored:1";
const localAlgorithm = "urn:usf:algorithm:local-contribution-preparation:1";

function normalizeOperations(basis: RealisationBasis, input: unknown, wire: boolean): FileOperation[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > 64) return refuse("LOCAL_OPERATIONS_BOUNDS");
  const seen = new Set<string>(); let bytes = 0;
  const operations = input.map(value => {
    const op = record(value, wire ? ["kind", "path", "content", "encoding", "mediaType", "expectedDigest"] : ["kind", "path", "content", "encoding", "mediaType"]);
    if (!isOperation(op) || !isRepositoryRelativePath(op.path) || op.path.length > 4096) return refuse("LOCAL_OPERATION_INVALID");
    if (seen.has(op.path)) return refuse("LOCAL_OPERATION_COLLISION");
    seen.add(op.path);
    if (!basis.scope.writeSet.some(scope => isPathWithinPermission(op.path, scope)) || !Object.hasOwn(basis.scope.preimages, op.path)) return refuse("LOCAL_SCOPE_UNDECLARED");
    const preimage = basis.scope.preimages[op.path];
    if (preimage !== null && !validDigest(preimage)) return refuse("LOCAL_PREIMAGE_MISMATCH");
    if (op.kind === "delete" && preimage === null) return refuse("LOCAL_DELETE_ABSENT");
    const encoding = op.encoding ?? "utf8";
    if (op.kind === "write") {
      bytes += Buffer.byteLength(op.content!, "utf8");
      if (bytes > 1048576 || (encoding === "base64" && Buffer.from(op.content!, "base64").toString("base64") !== op.content)) return refuse("LOCAL_OPERATIONS_BOUNDS");
    }
    if (wire && op.expectedDigest !== (preimage ?? undefined)) return refuse("LOCAL_PREIMAGE_MISMATCH");
    return { kind: op.kind, path: op.path, ...(op.kind === "write" ? { content: op.content!, encoding, ...(op.mediaType === undefined ? {} : { mediaType: op.mediaType }) } : {}), ...(preimage === null ? {} : { expectedDigest: preimage }) } as FileOperation;
  });
  return operations.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

export function localContributionDigest(value: Omit<LocalContribution, "identity"> & { readonly identity: { readonly basisDigest: string } }): string {
  return canonicalDigest({ ...value, identity: { basisDigest: value.identity.basisDigest } });
}

/** Pure structural constructor. Only prepareLocalContribution observes current repository authority. */
export function createLocalContribution(basisInput: RealisationBasis, proposedOperations: unknown, toolDigest: string | null = null): LocalContribution {
  const basis = parseRealisationBasis(basisInput);
  for (const id of [localSource, localAlgorithm]) {
    const required = basis.trace.requirements.filter(r => r.id === id);
    const dependencies = basis.work.dependencies.filter(d => d.kind === "semantic-resource" && d.key === id);
    if (required.length !== 1 || dependencies.length !== 1 || required[0]!.digest !== dependencies[0]!.digest) return refuse("LOCAL_SOURCE_NOT_ADMITTED");
  }
  if (toolDigest !== null && !validDigest(toolDigest)) return refuse("LOCAL_TOOL_DIGEST_INVALID");
  const operations = normalizeOperations(basis, proposedOperations, false);
  const body = { schema: "urn:usf:local-contribution:1" as const, kind: "local-contribution" as const, basis,
    identity: { basisDigest: basis.basisDigest }, payload: { operations },
    provenance: { sourceKind: "local-authored" as const, rootIdentity: basis.work.id, originalAuthor: null, model: null, tokens: null, cost: null,
      reviewIndependence: "unknown" as const, toolDigest, operationsDigest: canonicalDigest(operations) } };
  return immutable({ ...body, identity: { ...body.identity, artifactDigest: localContributionDigest(body) } });
}

export function parseLocalContribution(value: unknown): LocalContribution {
  try { return parseLocalContributionRecord(value); }
  catch (error) { if (error instanceof LocalContributionError) throw error; return refuse("LOCAL_BASIS_INVALID"); }
}

function parseLocalContributionRecord(value: unknown): LocalContribution {
  const v = record(value, ["schema", "kind", "basis", "identity", "payload", "provenance"]);
  if (v.schema !== "urn:usf:local-contribution:1" || v.kind !== "local-contribution") return refuse("LOCAL_CONTRIBUTION_KIND_INVALID");
  const identity = record(v.identity, ["artifactDigest", "basisDigest"]), payload = record(v.payload, ["operations"]);
  const p = record(v.provenance, ["sourceKind", "rootIdentity", "originalAuthor", "model", "tokens", "cost", "reviewIndependence", "toolDigest", "operationsDigest"]);
  if (p.sourceKind !== "local-authored" || p.originalAuthor !== null || p.model !== null || p.tokens !== null || p.cost !== null || p.reviewIndependence !== "unknown") return refuse("LOCAL_PROVENANCE_INVALID");
  const basis = parseRealisationBasis(v.basis);
  const operations = normalizeOperations(basis, payload.operations, true);
  const proposed = operations.map(({ expectedDigest: _expectedDigest, ...op }) => op);
  if (p.toolDigest !== null && !validDigest(p.toolDigest)) return refuse("LOCAL_TOOL_DIGEST_INVALID");
  const expected = createLocalContribution(basis, proposed, p.toolDigest as string | null);
  if (!validDigest(identity.artifactDigest) || canonicalJson(value) !== canonicalJson(expected)) return refuse("LOCAL_CONTRIBUTION_INTEGRITY_FAILURE");
  return expected;
}

async function observedDigest(root: string, path: string): Promise<string | null> {
  const absolute = join(root, path), parents: Array<{ path: string; dev: number; ino: number }> = [];
  let parent = dirname(absolute);
  while (parent !== root) {
    const s = await lstat(parent).catch((e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return null; throw e; });
    if (s === null) { parent = dirname(parent); continue; }
    if (!s.isDirectory() || s.isSymbolicLink()) return refuse("LOCAL_SOURCE_UNSAFE");
    parents.push({ path: parent, dev: s.dev, ino: s.ino }); parent = dirname(parent);
  }
  const before = await lstat(absolute).catch((e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return null; throw e; });
  if (before === null) return null;
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > 8388608) return refuse("LOCAL_SOURCE_UNSAFE");
  const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = await handle.stat();
    if (opened.dev !== before.dev || opened.ino !== before.ino || !opened.isFile() || opened.nlink !== 1) return refuse("LOCAL_SOURCE_MOVED");
    const buffer = Buffer.alloc(before.size + 1); let count = 0;
    while (count < buffer.length) { const chunk = await handle.read(buffer, count, buffer.length - count, count); if (chunk.bytesRead === 0) break; count += chunk.bytesRead; }
    const after = await handle.stat(), named = await lstat(absolute);
    if (count !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || named.dev !== before.dev || named.ino !== before.ino || named.isSymbolicLink()) return refuse("LOCAL_SOURCE_MOVED");
    for (const p of parents) { const s = await lstat(p.path); if (!s.isDirectory() || s.isSymbolicLink() || s.dev !== p.dev || s.ino !== p.ino) return refuse("LOCAL_SOURCE_MOVED"); }
    return sha256(buffer.subarray(0, count));
  } finally { await handle.close(); }
}

function localSelection(selection: { readonly rootIdentity: string; readonly manifestPath: string }) {
  record(selection, ["rootIdentity", "manifestPath"]);
  if (typeof selection.rootIdentity !== "string" || selection.rootIdentity.length > 4096 || !/^[A-Za-z][A-Za-z0-9+.-]*:[^\s]+$/.test(selection.rootIdentity) || !isRepositoryRelativePath(selection.manifestPath)) return refuse("LOCAL_SELECTION_INVALID");
  return Object.freeze({ ...selection });
}

async function prepareLocalSelectionContext(repositoryRoot: string, selection: { readonly rootIdentity: string; readonly manifestPath: string }) {
  selection = localSelection(selection);
  const root = await realpath(repositoryRoot);
  const graph = loadSemanticGraph(root, selection.manifestPath), P = "urn:usf:predicate:", T = "urn:usf:type:";
  const values = (s: string, p: string) => [...new Set(graph.quads.filter(q => q.subject === s && q.predicate === P + p && q.objectKind === "iri").map(q => q.object))];
  const context = deriveCliTransitionContext(graph, selection.rootIdentity);
  if (context.work === null) return refuse("LOCAL_ROOT_UNINTERPRETABLE");
  if (context.contract === null) return refuse("LOCAL_ROOT_AMBIGUOUS");
  if (context.diagnostics.some(d => d.reasonCode === "TRANSITION_FIELD_KIND_INVALID")) return refuse("LOCAL_SELECTION_INVALID");
  // Construction eligibility alone does not admit a contribution source or adapter.
  const requirements = values(context.contract, "requires");
  if (!requirements.includes(localSource) || !requirements.includes(localAlgorithm)
    || !values(localSource, "type").includes(T + "LocalContributionSource")
    || !values(localAlgorithm, "type").includes(T + "CliFieldDerivationRule")) return refuse("LOCAL_SOURCE_NOT_ADMITTED");
  if (context.profile === null) return refuse("LOCAL_PROFILE_AMBIGUOUS");
  const result = deriveWork(graph, { selector: selection.rootIdentity, profile: context.profile, maxItems: 1 });
  const packet = result.items?.[0];
  if (result.status !== "ok" || result.truncation?.truncated || result.items?.length !== 1 || packet?.id !== selection.rootIdentity || !packet.eligibility?.construction.eligible || !packet.realisationBasis) return refuse("LOCAL_CONSTRUCTION_REFUSED");
  const basis = await deriveCurrentRealisationBasis(root, packet.realisationBasis);
  assertSameBasis(packet.realisationBasis, basis);
  if (basis.work.id !== packet.id || basis.selection.profile !== packet.decisionBoundary.root
    || basis.selection.manifestPath !== selection.manifestPath) return refuse("LOCAL_SELECTION_INVALID");
  return Object.freeze({ root, basis });
}

async function prepareLocalContributionContext(repositoryRoot: string, selection: { readonly rootIdentity: string; readonly manifestPath: string }, proposedOperations: unknown) {
  selection = localSelection(selection);
  let snapshot: unknown;
  try { snapshot = structuredClone(proposedOperations); } catch { return refuse("LOCAL_CONTRIBUTION_INPUT_INVALID"); }
  const { root, basis } = await prepareLocalSelectionContext(repositoryRoot, selection);
  const contribution = createLocalContribution(basis, snapshot);
  const paths = contribution.payload.operations.map(op => op.path);
  const preimages = await deriveCandidatePreimages(root, basis, paths);
  for (const path of paths) if (await observedDigest(root, path) !== preimages[path]) return refuse("LOCAL_PREIMAGE_STALE");
  assertSameBasis(basis, await deriveCurrentRealisationBasis(root, basis));
  for (const path of paths) if (await observedDigest(root, path) !== preimages[path]) return refuse("LOCAL_PREIMAGE_STALE");
  const toolPath = fileURLToPath(import.meta.url);
  const toolDigest = await observedDigest(dirname(toolPath), toolPath.slice(dirname(toolPath).length + 1));
  if (toolDigest === null) return refuse("LOCAL_TOOL_SOURCE_MISSING");
  assertSameBasis(basis, await deriveCurrentRealisationBasis(root, basis));
  return Object.freeze({ basis, preimages: Object.freeze(preimages), toolDigest,
    contribution: createLocalContribution(basis, contribution.payload.operations.map(({ expectedDigest: _expectedDigest, ...op }) => op), toolDigest) });
}

/** Existing producer entrypoint; all authority inspection remains in the shared private context. */
export async function prepareLocalContribution(repositoryRoot: string, selection: { readonly rootIdentity: string; readonly manifestPath: string }, proposedOperations: unknown): Promise<LocalContribution> {
  return (await prepareLocalContributionContext(repositoryRoot, selection, proposedOperations)).contribution;
}

/** No proposed operations means unknown input, never an invented empty contribution. */
export async function inspectLocalContribution(repositoryRoot: string, selection: { readonly rootIdentity: string; readonly manifestPath: string }, proposedOperations?: unknown) {
  const fact = (kind: "basis" | "scope" | "authority" | "local-preimage" | "tool-source", identity: string, digest: string) => Object.freeze({ kind, identity, digest, current: true as const });
  const common = (basis: RealisationBasis) => ({ operation: "local-contribution" as const, executionAuthority: "none" as const, lockAvailability: "not-observed" as const,
    selection: Object.freeze({ workIri: basis.work.id, profileIri: basis.selection.profile, manifestPath: basis.selection.manifestPath }) });
  const selectionFacts = (basis: RealisationBasis) => [
    fact("basis", basis.work.id, basis.basisDigest),
    fact("scope", basis.work.id, canonicalDigest(basis.scope)),
    fact("authority", basis.authority.contract, canonicalDigest(basis.authority)),
  ];
  if (proposedOperations === undefined) {
    const context = await prepareLocalSelectionContext(repositoryRoot, selection);
    assertSameBasis(context.basis, await deriveCurrentRealisationBasis(context.root, context.basis));
    const reasonCode = "LOCAL_OPERATIONS_UNAVAILABLE";
    return Object.freeze({ ...common(context.basis), status: "unavailable" as const, reasonCode,
      facts: Object.freeze(selectionFacts(context.basis)),
      unavailable: Object.freeze([Object.freeze({ kind: "local-preimage" as const, identity: "proposedOperations", state: "missing" as const, reasonCode })]) });
  }
    const context = await prepareLocalContributionContext(repositoryRoot, selection, proposedOperations);
    return Object.freeze({ ...common(context.basis),
      status: "authenticated" as const, unavailable: Object.freeze([]), facts: Object.freeze([
        ...selectionFacts(context.basis),
        fact("tool-source", "src/collaboration/local-contribution.ts", context.toolDigest),
        ...Object.entries(context.preimages).map(([path, digest]) => fact("local-preimage", path, canonicalDigest({ path, digest }))),
      ]) });
}
