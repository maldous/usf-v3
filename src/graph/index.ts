import { readFileSync, realpathSync } from "node:fs";
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

/** Kept in the public structural type for in-memory fixtures; the loader accepts only v2. */
export interface LegacyGraphManifest {
  schema: "urn:usf:graph-manifest:1";
  version: 1;
  sources: GraphManifestSource[];
}

export type GraphManifest = GraphManifestV2 | LegacyGraphManifest;

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

function refuse(reason: string): never { throw new Error(reason); }

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
    || !item.path.endsWith(".nq")
    || item.format !== "application/n-quads"
    || typeof item.graph !== "string"
    || !item.graph.startsWith("urn:")
    || item.validationProfile !== "bootstrap-nquads-v1"
    || typeof item.role !== "string") refuse("MANIFEST_SOURCE_INVALID");
}

function repositoryRelativePath(value: string, reason: string): string {
  if (value.length === 0 || value.includes("\0") || value.includes("\\") || isAbsolute(value)) refuse(reason);
  const segments = value.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) refuse(reason);
  return segments.join("/");
}

function containedPath(root: string, repositoryPath: string, unreadableReason: string): string {
  const absolute = resolve(root, repositoryPath);
  const rootRelative = relative(root, absolute);
  if (rootRelative === "" || rootRelative === ".." || rootRelative.startsWith(`..${sep}`) || isAbsolute(rootRelative)) refuse("MANIFEST_PATH_ESCAPE");
  let canonical: string;
  try { canonical = realpathSync(absolute); } catch { return refuse(unreadableReason); }
  const canonicalRelative = relative(root, canonical);
  if (canonicalRelative === "" || canonicalRelative === ".." || canonicalRelative.startsWith(`..${sep}`) || isAbsolute(canonicalRelative)) refuse("MANIFEST_PATH_ESCAPE");
  return canonical;
}

function sameSource(left: GraphManifestSource, right: GraphManifestSource): boolean {
  return left.path === right.path
    && left.format === right.format
    && left.graph === right.graph
    && left.role === right.role
    && left.validationProfile === right.validationProfile;
}

export function loadSemanticGraph(repositoryRoot: string, manifestPath = "graph/manifest.json"): LoadedSemanticGraph {
  let root: string;
  try { root = realpathSync(resolve(repositoryRoot)); } catch { return refuse("REPOSITORY_ROOT_UNREADABLE"); }
  const selectedManifestPath = repositoryRelativePath(manifestPath, "MANIFEST_PATH_ESCAPE");
  const loadedByPath = new Map<string, LoadedGraphManifest>();
  const active = new Set<string>();
  const manifests: LoadedGraphManifest[] = [];
  const sources: GraphManifestSource[] = [];
  const sourceByPath = new Map<string, GraphManifestSource>();
  const sourceByGraph = new Map<string, GraphManifestSource>();

  const addSource = (value: unknown): void => {
    validateSource(value);
    const source = value;
    source.path = repositoryRelativePath(source.path, "MANIFEST_PATH_ESCAPE");
    const pathMatch = sourceByPath.get(source.path);
    const graphMatch = sourceByGraph.get(source.graph);
    if ((pathMatch && !sameSource(pathMatch, source)) || (graphMatch && !sameSource(graphMatch, source))) refuse("MANIFEST_DUPLICATE_SOURCE_OR_GRAPH");
    if (pathMatch || graphMatch) return;
    sourceByPath.set(source.path, source);
    sourceByGraph.set(source.graph, source);
    sources.push(source);
  };

  const loadManifest = (candidate: string): LoadedGraphManifest => {
    const path = repositoryRelativePath(candidate, "MANIFEST_PATH_ESCAPE");
    if (active.has(path)) refuse("MANIFEST_IMPORT_CYCLE");
    const prior = loadedByPath.get(path);
    if (prior) return prior;

    const absolute = containedPath(root, path, "MANIFEST_UNREADABLE");
    let content: string;
    let value: unknown;
    try { content = readFileSync(absolute, "utf8"); } catch { return refuse("MANIFEST_UNREADABLE"); }
    try { value = JSON.parse(content); } catch { return refuse("MANIFEST_INVALID_JSON"); }
    if (!isManifest(value)) refuse("MANIFEST_INVALID");

    active.add(path);
    try {
      for (const importedPath of value.imports) loadManifest(importedPath);
      for (const source of value.sources) addSource(source);
    } finally {
      active.delete(path);
    }

    const loaded = { path, digest: sha256(content), manifest: value };
    loadedByPath.set(path, loaded);
    manifests.push(loaded);
    return loaded;
  };

  const selected = loadManifest(selectedManifestPath);
  const quads: Quad[] = [];
  const sourceDigests: Record<string, string> = {};
  for (const source of sources) {
    const absolute = containedPath(root, source.path, "MANIFEST_SOURCE_UNREADABLE");
    let content: string;
    try { content = readFileSync(absolute, "utf8"); } catch { return refuse("MANIFEST_SOURCE_UNREADABLE"); }
    quads.push(...parseStrictNQuads(content, source.graph));
    sourceDigests[source.path] = sha256(content);
  }
  const graphDigests = Object.fromEntries(sources.map((source) => [source.graph, canonicalQuadDigest(quads.filter((quad) => quad.graph === source.graph))]));
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
