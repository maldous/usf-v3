import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { DataFactory, Parser, Store as N3Store, type Quad, type Term } from "n3";
import { Store as OxigraphStore } from "oxigraph";
import SHACLValidator from "rdf-validate-shacl";
import { canonicalizeDataset, sha256 } from "./canonical.ts";
import { queryLocalStore } from "./query.ts";
import {
  SemanticStoreError,
  semanticReasonCodes,
  type SemanticManifest,
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
  maxSourceBytes: 2 * 1024 * 1024,
  maxDatasetQuads: 100_000,
  maxQueryBytes: 64 * 1024,
  maxQueryResults: 1_000,
  maxShaclResults: 1_000,
  canonicalizationTimeoutMs: 5_000,
};

const manifestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schema", "version", "sources"],
  properties: {
    schema: { const: "urn:usf:semantic-store-manifest:1" },
    version: { const: 1 },
    sources: {
      type: "array",
      minItems: 1,
      maxItems: 10_000,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "format", "graph", "role"],
        properties: {
          path: { type: "string", minLength: 1 },
          format: { enum: ["application/n-quads", "application/n-triples", "application/trig", "text/turtle"] },
          graph: { type: "string", minLength: 1 },
          role: { type: "string", minLength: 1 },
        },
      },
    },
  },
} as const;

const validateManifest = new Ajv2020({ allErrors: true, strict: true }).compile(manifestSchema);

function containedPath(root: string, repositoryPath: string, reasonCode: typeof semanticReasonCodes.MANIFEST_PATH_REFUSED | typeof semanticReasonCodes.SOURCE_PATH_REFUSED): string {
  if (isAbsolute(repositoryPath) || repositoryPath.split(/[\\/]/u).some((part) => part === ".." || part === "")) {
    throw new SemanticStoreError(reasonCode, "Semantic store paths must be normalized repository-relative paths.", { path: repositoryPath });
  }
  const candidate = resolve(root, repositoryPath);
  const relation = relative(root, candidate);
  if (relation === "" || relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw new SemanticStoreError(reasonCode, "The semantic store path escapes the repository root.", { path: repositoryPath });
  }
  return candidate;
}

function readContainedFile(root: string, repositoryPath: string, maxBytes: number, reasonCode: typeof semanticReasonCodes.MANIFEST_PATH_REFUSED | typeof semanticReasonCodes.SOURCE_PATH_REFUSED): string {
  const candidate = containedPath(root, repositoryPath, reasonCode);
  let real: string;
  try {
    if (lstatSync(candidate).isSymbolicLink()) throw new Error("symbolic link");
    real = realpathSync(candidate);
  } catch (error) {
    throw new SemanticStoreError(
      reasonCode === semanticReasonCodes.MANIFEST_PATH_REFUSED ? semanticReasonCodes.MANIFEST_PATH_REFUSED : semanticReasonCodes.SOURCE_UNREADABLE,
      "The semantic store could not read a regular local file.",
      { path: repositoryPath, cause: error instanceof Error ? error.message : "unknown" },
    );
  }
  const relation = relative(root, real);
  if (relation === "" || relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw new SemanticStoreError(reasonCode, "A semantic store path resolves outside the repository root.", { path: repositoryPath });
  }
  const bytes = readFileSync(real);
  if (bytes.byteLength > maxBytes) {
    throw new SemanticStoreError(
      reasonCode === semanticReasonCodes.MANIFEST_PATH_REFUSED ? semanticReasonCodes.MANIFEST_INVALID : semanticReasonCodes.SOURCE_TOO_LARGE,
      "A semantic store input exceeds its configured byte limit.",
      { path: repositoryPath, bytes: bytes.byteLength, maxBytes },
    );
  }
  return bytes.toString("utf8");
}

function renameBlankNodes(quads: readonly Quad[], sourcePath: string, graphName: string): Quad[] {
  const prefix = sha256(sourcePath).slice("sha256:".length, "sha256:".length + 16);
  const names = new Map<string, Term>();
  const rename = (term: Term): Term => {
    if (term.termType === "Quad") {
      throw new SemanticStoreError(semanticReasonCodes.SOURCE_PARSE_FAILED, "RDF-star terms are outside the current semantic-store fixture profile.");
    }
    if (term.termType !== "BlankNode") return term;
    const existing = names.get(term.value);
    if (existing !== undefined) return existing;
    const replacement = DataFactory.blankNode(`${prefix}-${names.size}`);
    names.set(term.value, replacement);
    return replacement;
  };
  const graph = DataFactory.namedNode(graphName);
  return quads.map((quad) => DataFactory.quad(rename(quad.subject), rename(quad.predicate), rename(quad.object), graph));
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
    const root = realpathSync(resolve(options.repositoryRoot));
    const limits = { ...defaultLimits, ...options.limits };
    const manifestBytes = readContainedFile(root, options.manifestPath, limits.maxManifestBytes, semanticReasonCodes.MANIFEST_PATH_REFUSED);
    let manifestValue: unknown;
    try { manifestValue = JSON.parse(manifestBytes); }
    catch { throw new SemanticStoreError(semanticReasonCodes.MANIFEST_INVALID, "The semantic-store manifest is not valid JSON."); }
    if (!validateManifest(manifestValue)) {
      throw new SemanticStoreError(semanticReasonCodes.MANIFEST_INVALID, "The semantic-store manifest does not satisfy its closed schema.", { errors: validateManifest.errors ?? [] });
    }
    const manifest = manifestValue as SemanticManifest;
    const paths = new Set<string>();
    const graphs = new Set<string>();
    const quads: Quad[] = [];
    const sourceDigests: Record<string, string> = {};
    for (const source of manifest.sources) {
      if (paths.has(source.path) || graphs.has(source.graph)) {
        throw new SemanticStoreError(semanticReasonCodes.MANIFEST_INVALID, "Manifest source paths and graph names must be unique.");
      }
      paths.add(source.path);
      graphs.add(source.graph);
      let content: string;
      try { content = readContainedFile(root, source.path, limits.maxSourceBytes, semanticReasonCodes.SOURCE_PATH_REFUSED); }
      catch (error) { if (error instanceof SemanticStoreError) throw error; throw new SemanticStoreError(semanticReasonCodes.SOURCE_UNREADABLE, "A semantic source is unreadable."); }
      let parsed: Quad[];
      try { parsed = new Parser({ format: source.format }).parse(content); }
      catch (error) {
        throw new SemanticStoreError(semanticReasonCodes.SOURCE_PARSE_FAILED, "A manifest-selected RDF source did not parse.", { path: source.path, cause: error instanceof Error ? error.message : "unknown" });
      }
      quads.push(...renameBlankNodes(parsed, source.path, source.graph));
      if (quads.length > limits.maxDatasetQuads) {
        throw new SemanticStoreError(semanticReasonCodes.DATASET_TOO_LARGE, "The manifest-selected RDF dataset exceeds its configured quad limit.");
      }
      sourceDigests[source.path] = sha256(content);
    }
    const canonical = await canonicalizeDataset(quads, { timeoutMs: limits.canonicalizationTimeoutMs });
    const oxigraph = new OxigraphStore();
    oxigraph.load(canonical.canonicalNQuads, { format: "application/n-quads" });
    return new RepositorySemanticStore(limits, quads, oxigraph, {
      semanticDigest: canonical.semanticDigest,
      canonicalNQuads: canonical.canonicalNQuads,
      quadCount: quads.length,
      graphNames: [...graphs].sort(),
      sourceDigests: Object.fromEntries(Object.entries(sourceDigests).sort(([left], [right]) => left.localeCompare(right))),
    });
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
