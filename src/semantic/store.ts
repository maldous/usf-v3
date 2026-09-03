import { DataFactory, Parser, Store as N3Store, type Quad } from "n3";
import { Store as OxigraphStore } from "oxigraph";
import SHACLValidator from "rdf-validate-shacl";
import { GraphLoadError, loadSemanticGraph } from "../graph/index.ts";
import { canonicalNQuads } from "../graph/nquads.ts";
import { queryLocalStore } from "./query.ts";
import {
  SemanticStoreError,
  semanticReasonCodes,
  type SemanticQueryResult,
  type SemanticSnapshot,
  type SemanticStore,
  type SemanticStoreLimits,
  type SemanticTerm,
  type ShaclReport,
  type ShaclResult,
} from "./types.ts";

const defaultLimits: SemanticStoreLimits = {
  maxManifestBytes: 64 * 1024,
  maxTotalManifestBytes: 4 * 1024 * 1024,
  maxManifestCount: 256,
  maxManifestDepth: 32,
  maxSourceCount: 1_024,
  // Raised from 2 MiB on 2026-09-03. The delivery contract graph legitimately
  // exceeded it, so at 2 MiB this guard refused the repository's own largest
  // authored source rather than protecting against a malformed one. The
  // aggregate bound is unchanged, so loading stays bounded; a single source
  // approaching this figure again is a signal to split the graph rather than
  // to raise the guard a second time.
  maxSourceBytes: 4 * 1024 * 1024,
  maxTotalSourceBytes: 64 * 1024 * 1024,
  maxDatasetQuads: 100_000,
  maxQueryBytes: 64 * 1024,
  maxQueryResults: 1_000,
  maxShaclResults: 1_000,
  canonicalizationTimeoutMs: 5_000,
};

function checkedStoreLimits(overrides: Partial<SemanticStoreLimits> | undefined): SemanticStoreLimits {
  const known = new Set(Object.keys(defaultLimits));
  if (overrides !== undefined && Object.keys(overrides).some((key) => !known.has(key))) {
    throw new SemanticStoreError(semanticReasonCodes.STORE_LIMIT_INVALID, "Semantic-store limit overrides must use only supported keys.");
  }
  const limits = { ...defaultLimits, ...overrides };
  if (Object.values(limits).some((value) => !Number.isSafeInteger(value) || value < 1)) {
    throw new SemanticStoreError(semanticReasonCodes.STORE_LIMIT_INVALID, "Semantic-store limits must be positive safe integers.");
  }
  return limits;
}

function graphLoadFailure(error: unknown): SemanticStoreError {
  if (!(error instanceof GraphLoadError)) {
    return new SemanticStoreError(semanticReasonCodes.MANIFEST_INVALID, "The graph-manifest v2 loader refused the semantic dataset.", { cause: error instanceof Error ? error.message : "unknown" });
  }
  const reasonCode = (() => {
    if (["REPOSITORY_ROOT_UNREADABLE", "MANIFEST_PATH_ESCAPE", "MANIFEST_UNREADABLE"].includes(error.reasonCode)) return semanticReasonCodes.MANIFEST_PATH_REFUSED;
    if (error.reasonCode === "MANIFEST_SOURCE_PATH_ESCAPE") return semanticReasonCodes.SOURCE_PATH_REFUSED;
    if (error.reasonCode === "MANIFEST_SOURCE_UNREADABLE") return semanticReasonCodes.SOURCE_UNREADABLE;
    if (["MANIFEST_SOURCE_TOO_LARGE", "MANIFEST_SOURCE_TOTAL_BYTES_EXCEEDED"].includes(error.reasonCode)) return semanticReasonCodes.SOURCE_TOO_LARGE;
    if (error.reasonCode === "DATASET_QUAD_LIMIT_EXCEEDED") return semanticReasonCodes.DATASET_TOO_LARGE;
    if (["MANIFEST_SOURCE_PARSE_FAILED", "MANIFEST_SOURCE_INVALID_UTF8"].includes(error.reasonCode)) return semanticReasonCodes.SOURCE_PARSE_FAILED;
    return semanticReasonCodes.MANIFEST_INVALID;
  })();
  return new SemanticStoreError(reasonCode, "The graph-manifest v2 loader refused the semantic dataset.", { graphReasonCode: error.reasonCode, ...error.details });
}

function semanticTerm(term: { readonly termType: string; readonly value: string; readonly language?: string; readonly datatype?: { readonly value: string } }): SemanticTerm {
  return {
    termType: term.termType,
    value: term.value,
    ...(term.language !== undefined && term.language !== "" ? { language: term.language } : {}),
    ...(term.datatype !== undefined ? { datatype: term.datatype.value } : {}),
  };
}

function shaclResult(result: {
  readonly focusNode: Parameters<typeof semanticTerm>[0];
  readonly path?: Parameters<typeof semanticTerm>[0];
  readonly severity: Parameters<typeof semanticTerm>[0];
  readonly sourceConstraintComponent: Parameters<typeof semanticTerm>[0];
  readonly sourceShape: Parameters<typeof semanticTerm>[0];
  readonly message: readonly { readonly value: string }[];
}): ShaclResult {
  return {
    focusNode: semanticTerm(result.focusNode),
    ...(result.path === undefined ? {} : { path: semanticTerm(result.path) }),
    severity: semanticTerm(result.severity),
    sourceConstraintComponent: semanticTerm(result.sourceConstraintComponent),
    sourceShape: semanticTerm(result.sourceShape),
    messages: result.message.map((message) => message.value).sort(),
  };
}

export class RepositorySemanticStore implements SemanticStore {
  readonly #limits: SemanticStoreLimits;
  readonly #quads: readonly Quad[];
  readonly #oxigraph: OxigraphStore;
  readonly #snapshot: SemanticSnapshot;

  private constructor(limits: SemanticStoreLimits, quads: readonly Quad[], oxigraph: OxigraphStore, snapshot: SemanticSnapshot) {
    this.#limits = limits;
    this.#quads = quads;
    this.#oxigraph = oxigraph;
    this.#snapshot = snapshot;
  }

  static async open(options: {
    readonly repositoryRoot: string;
    readonly manifestPath: string;
    readonly limits?: Partial<SemanticStoreLimits>;
  }): Promise<RepositorySemanticStore> {
    const limits = checkedStoreLimits(options.limits);
    let loaded: ReturnType<typeof loadSemanticGraph>;
    try {
      loaded = loadSemanticGraph(options.repositoryRoot, options.manifestPath, {
        maxManifestBytes: limits.maxManifestBytes,
        maxTotalManifestBytes: limits.maxTotalManifestBytes,
        maxManifestCount: limits.maxManifestCount,
        maxManifestDepth: limits.maxManifestDepth,
        maxSourceCount: limits.maxSourceCount,
        maxSourceBytes: limits.maxSourceBytes,
        maxTotalSourceBytes: limits.maxTotalSourceBytes,
        maxDatasetQuads: limits.maxDatasetQuads,
      });
    } catch (error) { throw graphLoadFailure(error); }
    const canonical = canonicalNQuads(loaded.quads);
    // N3 is a query/SHACL projection of the already validated canonical dataset, never a source-ingestion path.
    const quads = new Parser({ format: "application/n-quads" }).parse(canonical);
    const graphs = loaded.sources.map((source) => source.graph).sort();
    const oxigraph = new OxigraphStore();
    oxigraph.load(canonical, { format: "application/n-quads" });
    const snapshot: SemanticSnapshot = Object.freeze({
      semanticDigest: loaded.semanticDigest,
      canonicalNQuads: canonical,
      quadCount: quads.length,
      graphNames: Object.freeze(graphs),
      graphDigests: Object.freeze(Object.fromEntries(Object.entries(loaded.graphDigests).sort(([left], [right]) => left.localeCompare(right)))),
      sourceDigests: Object.freeze(Object.fromEntries(Object.entries(loaded.sourceDigests).sort(([left], [right]) => left.localeCompare(right)))),
    });
    return new RepositorySemanticStore(limits, quads, oxigraph, snapshot);
  }

  snapshot(): SemanticSnapshot {
    return this.#snapshot;
  }

  async query(sparql: string, options: { readonly maxResults?: number } = {}): Promise<SemanticQueryResult> {
    return queryLocalStore(this.#oxigraph, sparql, {
      ...options,
      maxQueryBytes: this.#limits.maxQueryBytes,
      maxQueryResults: this.#limits.maxQueryResults,
      canonicalizationTimeoutMs: this.#limits.canonicalizationTimeoutMs,
    });
  }

  async validateShacl(options: {
    readonly shapeGraphs: readonly string[];
    readonly dataGraphs: readonly string[];
    readonly maxResults?: number;
  }): Promise<ShaclReport> {
    const maxResults = options.maxResults ?? this.#limits.maxShaclResults;
    if (!Number.isSafeInteger(maxResults) || maxResults < 1 || maxResults > this.#limits.maxShaclResults) {
      throw new SemanticStoreError(semanticReasonCodes.SHACL_LIMIT_REFUSED, "The requested SHACL result bound is outside the configured limit.");
    }
    const loadedGraphs = new Set(this.#snapshot.graphNames);
    const selected = [...options.shapeGraphs, ...options.dataGraphs];
    if (selected.length === 0 || selected.some((graph) => !loadedGraphs.has(graph))) {
      throw new SemanticStoreError(semanticReasonCodes.SHACL_GRAPH_UNKNOWN, "SHACL validation may use only manifest-loaded named graphs.");
    }
    const inGraphs = (graphs: readonly string[]): N3Store => {
      const names = new Set(graphs);
      return new N3Store(this.#quads.filter((quad) => names.has(quad.graph.value)).map((quad) => DataFactory.quad(quad.subject, quad.predicate, quad.object)));
    };
    try {
      const validator = new SHACLValidator(inGraphs(options.shapeGraphs) as never, { maxErrors: maxResults + 1 });
      const report = await validator.validate(inGraphs(options.dataGraphs) as never);
      const allResults = report.results.map((result) => shaclResult(result as never));
      const ordered = allResults.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
      return {
        conforms: report.conforms,
        results: ordered.slice(0, maxResults),
        resultCount: ordered.length,
        truncated: ordered.length > maxResults,
      };
    } catch (error) {
      if (error instanceof SemanticStoreError) throw error;
      throw new SemanticStoreError(semanticReasonCodes.SHACL_VALIDATION_FAILED, "The maintained SHACL validator could not evaluate the selected graphs.", { cause: error instanceof Error ? error.message : "unknown" });
    }
  }
}
