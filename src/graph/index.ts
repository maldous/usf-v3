import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { canonicalQuadDigest, parseStrictNQuads, sha256, type Quad } from "./nquads.ts";

export interface GraphManifestSource {
  path: string;
  format: "application/n-quads";
  graph: string;
  role: string;
  validationProfile: "bootstrap-nquads-v1";
}

export interface GraphManifestV2 {
  schema: "urn:usf:graph-manifest:2";
  version: 2;
  imports: string[];
  sources: GraphManifestSource[];
}

export type GraphManifest = GraphManifestV2;

export interface GraphLoadLimits {
  maxManifestBytes: number;
  maxTotalManifestBytes: number;
  maxManifestCount: number;
  maxManifestDepth: number;
  maxSourceCount: number;
  maxSourceBytes: number;
  maxTotalSourceBytes: number;
  maxDatasetQuads: number;
}

export const defaultGraphLoadLimits: Readonly<GraphLoadLimits> = {
  maxManifestBytes: 64 * 1024,
  maxTotalManifestBytes: 4 * 1024 * 1024,
  maxManifestCount: 256,
  maxManifestDepth: 32,
  maxSourceCount: 1_024,
  maxSourceBytes: 2 * 1024 * 1024,
  maxTotalSourceBytes: 64 * 1024 * 1024,
  maxDatasetQuads: 100_000,
};

export class GraphLoadError extends Error {
  readonly reasonCode: string;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(reasonCode: string, details?: Readonly<Record<string, unknown>>) {
    super(reasonCode);
    this.name = "GraphLoadError";
    this.reasonCode = reasonCode;
    this.details = details;
  }
}

export interface LoadedGraphManifest {
  path: string;
  digest: string;
  manifest: GraphManifestV2;
}

export interface SemanticGraph {
  manifest: GraphManifest;
  quads: Quad[];
  semanticDigest: string;
  graphDigests: Record<string, string>;
  sourceDigests: Record<string, string>;
  repositoryRoot: string;
}

export interface LoadedSemanticGraph extends SemanticGraph {
  /** The explicitly selected root manifest, before import expansion. */
  manifest: GraphManifestV2;
  manifestPath: string;
  /** Imported manifests followed by their importers, with each path present once. */
  manifests: LoadedGraphManifest[];
  /** The deterministic, deduplicated source expansion used to construct the graph. */
  sources: GraphManifestSource[];
}

function refuse(reason: string, details?: Readonly<Record<string, unknown>>): never { throw new GraphLoadError(reason, details); }

function isManifest(value: unknown): value is GraphManifestV2 {
  if (typeof value !== "object" || value === null) return false;
  const manifest = value as Partial<GraphManifestV2>;
  return Object.keys(manifest).sort().join(",") === "imports,schema,sources,version"
    && manifest.schema === "urn:usf:graph-manifest:2"
    && manifest.version === 2
    && Array.isArray(manifest.imports)
    && manifest.imports.every((entry) => typeof entry === "string")
    && Array.isArray(manifest.sources);
}

function validateSource(source: unknown): asserts source is GraphManifestSource {
  if (typeof source !== "object" || source === null) refuse("MANIFEST_SOURCE_INVALID");
  const item = source as Partial<GraphManifestSource>;
  if (Object.keys(item).sort().join(",") !== "format,graph,path,role,validationProfile"
    || typeof item.path !== "string"
    || item.format !== "application/n-quads"
    || typeof item.graph !== "string"
    || !/^urn:[^<>\s]+$/u.test(item.graph)
    || item.validationProfile !== "bootstrap-nquads-v1"
    || typeof item.role !== "string"
    || item.role.length === 0) refuse("MANIFEST_SOURCE_INVALID");
}

function repositoryRelativePath(value: string, reason: string): string {
  if (value.length === 0 || value.includes("\0") || value.includes("\\") || isAbsolute(value)) refuse(reason);
  const segments = value.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) refuse(reason);
  return segments.join("/");
}

function containedPath(root: string, repositoryPath: string, escapeReason: string, unreadableReason: string): string {
  const absolute = resolve(root, repositoryPath);
  const rootRelative = relative(root, absolute);
  if (rootRelative === "" || rootRelative === ".." || rootRelative.startsWith(`..${sep}`) || isAbsolute(rootRelative)) refuse(escapeReason);
  let cursor = root;
  try {
    for (const segment of repositoryPath.split("/")) {
      cursor = resolve(cursor, segment);
      const status = lstatSync(cursor);
      if (status.isSymbolicLink()) refuse(escapeReason, { path: repositoryPath });
      if (cursor === absolute && !status.isFile()) refuse(unreadableReason, { path: repositoryPath });
    }
  } catch (error) {
    if (error instanceof GraphLoadError) throw error;
    return refuse(unreadableReason, { path: repositoryPath });
  }
  let canonical: string;
  try { canonical = realpathSync(absolute); } catch { return refuse(unreadableReason); }
  const canonicalRelative = relative(root, canonical);
  if (canonicalRelative === "" || canonicalRelative === ".." || canonicalRelative.startsWith(`..${sep}`) || isAbsolute(canonicalRelative)) refuse(escapeReason);
  return canonical;
}

function readBoundedFile(
  root: string,
  repositoryPath: string,
  maximumBytes: number,
  escapeReason: string,
  unreadableReason: string,
  tooLargeReason: string,
  aggregateRemainingBytes: number,
  aggregateTooLargeReason: string,
): Buffer {
  const absolute = containedPath(root, repositoryPath, escapeReason, unreadableReason);
  let status: ReturnType<typeof lstatSync>;
  try { status = lstatSync(absolute); } catch { return refuse(unreadableReason, { path: repositoryPath }); }
  if (status.size > maximumBytes) refuse(tooLargeReason, { path: repositoryPath, bytes: status.size, maximumBytes });
  if (status.size > aggregateRemainingBytes) refuse(aggregateTooLargeReason, { path: repositoryPath, bytes: status.size, aggregateRemainingBytes });
  let content: Buffer;
  try { content = readFileSync(absolute); } catch { return refuse(unreadableReason, { path: repositoryPath }); }
  if (content.byteLength > maximumBytes) refuse(tooLargeReason, { path: repositoryPath, bytes: content.byteLength, maximumBytes });
  if (content.byteLength > aggregateRemainingBytes) refuse(aggregateTooLargeReason, { path: repositoryPath, bytes: content.byteLength, aggregateRemainingBytes });
  return content;
}

function decodeUtf8(content: Buffer, reason: string, path: string): string {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(content); }
  catch { return refuse(reason, { path }); }
}

function checkedLimits(overrides: Partial<GraphLoadLimits>): GraphLoadLimits {
  const known = new Set(Object.keys(defaultGraphLoadLimits));
  if (Object.keys(overrides).some((key) => !known.has(key))) refuse("GRAPH_LOAD_LIMIT_INVALID");
  const limits = { ...defaultGraphLoadLimits, ...overrides };
  if (Object.values(limits).some((value) => !Number.isSafeInteger(value) || value < 1)) refuse("GRAPH_LOAD_LIMIT_INVALID");
  return limits;
}

function sameSource(left: GraphManifestSource, right: GraphManifestSource): boolean {
  return left.path === right.path
    && left.format === right.format
    && left.graph === right.graph
    && left.role === right.role
    && left.validationProfile === right.validationProfile;
}

export function loadSemanticGraph(repositoryRoot: string, manifestPath = "graph/manifest.json", limitOverrides: Partial<GraphLoadLimits> = {}): LoadedSemanticGraph {
  let root: string;
  try { root = realpathSync(resolve(repositoryRoot)); } catch { return refuse("REPOSITORY_ROOT_UNREADABLE"); }
  const limits = checkedLimits(limitOverrides);
  const selectedManifestPath = repositoryRelativePath(manifestPath, "MANIFEST_PATH_ESCAPE");
  const loadedByPath = new Map<string, LoadedGraphManifest>();
  const active = new Set<string>();
  const manifests: LoadedGraphManifest[] = [];
  const sources: GraphManifestSource[] = [];
  const sourceByPath = new Map<string, GraphManifestSource>();
  const sourceByGraph = new Map<string, GraphManifestSource>();
  let totalManifestBytes = 0;
  let totalSourceBytes = 0;

  const addSource = (value: unknown): void => {
    validateSource(value);
    const source = value;
    const normalized: GraphManifestSource = { ...source, path: repositoryRelativePath(source.path, "MANIFEST_SOURCE_PATH_ESCAPE") };
    const pathMatch = sourceByPath.get(normalized.path);
    const graphMatch = sourceByGraph.get(normalized.graph);
    if ((pathMatch && !sameSource(pathMatch, normalized)) || (graphMatch && !sameSource(graphMatch, normalized))) refuse("MANIFEST_DUPLICATE_SOURCE_OR_GRAPH");
    if (pathMatch || graphMatch) return;
    if (sources.length >= limits.maxSourceCount) refuse("MANIFEST_SOURCE_LIMIT_EXCEEDED");
    sourceByPath.set(normalized.path, normalized);
    sourceByGraph.set(normalized.graph, normalized);
    sources.push(normalized);
  };

  const loadManifest = (candidate: string, depth: number): LoadedGraphManifest => {
    if (depth > limits.maxManifestDepth) refuse("MANIFEST_IMPORT_DEPTH_EXCEEDED");
    const path = repositoryRelativePath(candidate, "MANIFEST_PATH_ESCAPE");
    if (active.has(path)) refuse("MANIFEST_IMPORT_CYCLE");
    const prior = loadedByPath.get(path);
    if (prior) return prior;

    if (loadedByPath.size + active.size >= limits.maxManifestCount) refuse("MANIFEST_LIMIT_EXCEEDED");
    const bytes = readBoundedFile(
      root,
      path,
      limits.maxManifestBytes,
      "MANIFEST_PATH_ESCAPE",
      "MANIFEST_UNREADABLE",
      "MANIFEST_TOO_LARGE",
      limits.maxTotalManifestBytes - totalManifestBytes,
      "MANIFEST_TOTAL_BYTES_EXCEEDED",
    );
    totalManifestBytes += bytes.byteLength;
    if (totalManifestBytes > limits.maxTotalManifestBytes) refuse("MANIFEST_TOTAL_BYTES_EXCEEDED");
    const content = decodeUtf8(bytes, "MANIFEST_INVALID_UTF8", path);
    let value: unknown;
    try { value = JSON.parse(content); } catch { return refuse("MANIFEST_INVALID_JSON"); }
    if (!isManifest(value)) refuse("MANIFEST_INVALID");

    active.add(path);
    try {
      for (const importedPath of value.imports) loadManifest(importedPath, depth + 1);
      for (const source of value.sources) addSource(source);
    } finally {
      active.delete(path);
    }

    const loaded = { path, digest: sha256(bytes), manifest: value };
    loadedByPath.set(path, loaded);
    manifests.push(loaded);
    return loaded;
  };

  const selected = loadManifest(selectedManifestPath, 1);
  const quads: Quad[] = [];
  const quadsByGraph = new Map<string, Quad[]>(sources.map((source) => [source.graph, []]));
  const sourceDigestEntries: Array<readonly [string, string]> = [];
  for (const source of sources) {
    const bytes = readBoundedFile(
      root,
      source.path,
      limits.maxSourceBytes,
      "MANIFEST_SOURCE_PATH_ESCAPE",
      "MANIFEST_SOURCE_UNREADABLE",
      "MANIFEST_SOURCE_TOO_LARGE",
      limits.maxTotalSourceBytes - totalSourceBytes,
      "MANIFEST_SOURCE_TOTAL_BYTES_EXCEEDED",
    );
    totalSourceBytes += bytes.byteLength;
    if (totalSourceBytes > limits.maxTotalSourceBytes) refuse("MANIFEST_SOURCE_TOTAL_BYTES_EXCEEDED");
    const content = decodeUtf8(bytes, "MANIFEST_SOURCE_INVALID_UTF8", source.path);
    let parsed: Quad[];
    try { parsed = parseStrictNQuads(content, source.graph, limits.maxDatasetQuads - quads.length); }
    catch (error) {
      if (error instanceof Error && error.message === "NQUADS_QUAD_LIMIT_EXCEEDED") refuse("DATASET_QUAD_LIMIT_EXCEEDED");
      return refuse("MANIFEST_SOURCE_PARSE_FAILED", { path: source.path, cause: error instanceof Error ? error.message : "unknown" });
    }
    quads.push(...parsed);
    quadsByGraph.get(source.graph)?.push(...parsed);
    sourceDigestEntries.push([source.path, sha256(bytes)]);
  }
  const graphDigests = Object.fromEntries(sources
    .map((source) => [source.graph, canonicalQuadDigest(quadsByGraph.get(source.graph) ?? [])] as const)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
  const sourceDigests = Object.fromEntries(sourceDigestEntries.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
  return {
    manifest: selected.manifest,
    manifestPath: selectedManifestPath,
    manifests,
    sources,
    quads,
    semanticDigest: canonicalQuadDigest(quads),
    graphDigests,
    sourceDigests,
    repositoryRoot: root,
  };
}

export function objectsFor(graph: SemanticGraph, subject: string, predicate?: string): Quad[] {
  return graph.quads.filter((quad) => quad.subject === subject && (predicate === undefined || quad.predicate === predicate));
}

export function objectValues(graph: SemanticGraph, subject: string, predicate: string): string[] {
  return objectsFor(graph, subject, predicate).map((quad) => quad.object).sort();
}

export function resourceDigest(graph: SemanticGraph, resource: string): string {
  const quads = graph.quads.filter((quad) => quad.subject === resource);
  return canonicalQuadDigest(quads);
}

export function resourceExists(graph: SemanticGraph, resource: string): boolean {
  return graph.quads.some((quad) => quad.subject === resource);
}

export interface ValidationRuntimeClosure {
  readonly id: string | null;
  readonly resourceDigest: string | null;
  readonly repositoryReadFiles: readonly string[];
}

/**
 * Select the optional graph-authored supplemental file closure for one
 * validation. The relation is intentionally incoming so extending a
 * validation's current execution imports does not rewrite its admitted
 * resource identity or the work packet that originally selected it.
 */
export function validationRuntimeClosure(graph: SemanticGraph, validationId: string): ValidationRuntimeClosure {
  const forValidation = "urn:usf:predicate:forValidation";
  const type = "urn:usf:predicate:type";
  const version = "urn:usf:predicate:version";
  const repositoryReadFile = "urn:usf:predicate:repositoryReadFile";
  const closureType = "urn:usf:type:ValidationRuntimeClosure";
  const candidates = [...new Set(graph.quads
    .filter((quad) => quad.predicate === forValidation && quad.objectKind === "iri" && quad.object === validationId)
    .map((quad) => quad.subject))].sort();
  if (candidates.length === 0) return Object.freeze({ id: null, resourceDigest: null, repositoryReadFiles: Object.freeze([]) });
  if (candidates.length !== 1) throw new Error(`VALIDATION_RUNTIME_CLOSURE_AMBIGUOUS:${validationId}`);
  const id = candidates[0] as string;
  const types = objectsFor(graph, id, type);
  const versions = objectsFor(graph, id, version);
  const validationBindings = objectsFor(graph, id, forValidation);
  const fileBindings = objectsFor(graph, id, repositoryReadFile);
  if (types.length !== 1 || types[0]?.objectKind !== "iri" || types[0].object !== closureType
    || versions.length !== 1 || versions[0]?.objectKind !== "literal" || versions[0].object !== "1"
    || validationBindings.length < 1 || validationBindings.length > 32
    || validationBindings.some((quad) => quad.objectKind !== "iri")
    || new Set(validationBindings.map((quad) => quad.object)).size !== validationBindings.length
    || !validationBindings.some((quad) => quad.object === validationId)
    || fileBindings.length < 1 || fileBindings.length > 64
    || fileBindings.some((quad) => quad.objectKind !== "literal")
    || new Set(fileBindings.map((quad) => quad.object)).size !== fileBindings.length) {
    throw new Error(`VALIDATION_RUNTIME_CLOSURE_INVALID:${validationId}`);
  }
  return Object.freeze({
    id,
    resourceDigest: resourceDigest(graph, id),
    repositoryReadFiles: Object.freeze(fileBindings.map((quad) => quad.object).sort()),
  });
}

/** Deterministic outbound closure. Unauthored vocabulary IRIs are leaves. */
export function transitiveResourceIris(graph: SemanticGraph, seeds: Iterable<string>, maxResources = 1_000): string[] {
  const pending = [...new Set(seeds)].sort();
  const visited = new Set<string>();
  while (pending.length > 0) {
    const resource = pending.shift() as string;
    if (visited.has(resource)) continue;
    if (!resourceExists(graph, resource)) throw new Error(`SEMANTIC_RESOURCE_UNRESOLVED:${resource}`);
    visited.add(resource);
    if (visited.size > maxResources) throw new Error("SEMANTIC_DEPENDENCY_LIMIT_EXCEEDED");
    pending.push(...objectsFor(graph, resource)
      .filter((quad) => quad.objectKind === "iri" && resourceExists(graph, quad.object) && !visited.has(quad.object))
      .map((quad) => quad.object));
    pending.sort();
  }
  return [...visited].sort();
}
