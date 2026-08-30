export const semanticReasonCodes = {
  STORE_LIMIT_INVALID: "SEMANTIC_STORE_LIMIT_INVALID",
  MANIFEST_INVALID: "SEMANTIC_MANIFEST_INVALID",
  MANIFEST_PATH_REFUSED: "SEMANTIC_MANIFEST_PATH_REFUSED",
  SOURCE_PATH_REFUSED: "SEMANTIC_SOURCE_PATH_REFUSED",
  SOURCE_UNREADABLE: "SEMANTIC_SOURCE_UNREADABLE",
  SOURCE_TOO_LARGE: "SEMANTIC_SOURCE_TOO_LARGE",
  SOURCE_PARSE_FAILED: "SEMANTIC_SOURCE_PARSE_FAILED",
  DATASET_TOO_LARGE: "SEMANTIC_DATASET_TOO_LARGE",
  CANONICALIZATION_FAILED: "SEMANTIC_CANONICALIZATION_FAILED",
  QUERY_INVALID: "SEMANTIC_QUERY_INVALID",
  QUERY_FORM_REFUSED: "SEMANTIC_QUERY_FORM_REFUSED",
  QUERY_UPDATE_REFUSED: "SEMANTIC_QUERY_UPDATE_REFUSED",
  QUERY_SERVICE_REFUSED: "SEMANTIC_QUERY_SERVICE_REFUSED",
  QUERY_REMOTE_GRAPH_REFUSED: "SEMANTIC_QUERY_REMOTE_GRAPH_REFUSED",
  QUERY_UNBOUNDED_REFUSED: "SEMANTIC_QUERY_UNBOUNDED_REFUSED",
  QUERY_LIMIT_REFUSED: "SEMANTIC_QUERY_LIMIT_REFUSED",
  QUERY_RESULT_LIMIT_EXCEEDED: "SEMANTIC_QUERY_RESULT_LIMIT_EXCEEDED",
  SHACL_GRAPH_UNKNOWN: "SEMANTIC_SHACL_GRAPH_UNKNOWN",
  SHACL_LIMIT_REFUSED: "SEMANTIC_SHACL_LIMIT_REFUSED",
  SHACL_VALIDATION_FAILED: "SEMANTIC_SHACL_VALIDATION_FAILED",
} as const;

export type SemanticReasonCode = (typeof semanticReasonCodes)[keyof typeof semanticReasonCodes];

export class SemanticStoreError extends Error {
  readonly reasonCode: SemanticReasonCode;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(reasonCode: SemanticReasonCode, message: string, details?: Readonly<Record<string, unknown>>) {
    super(message);
    this.name = "SemanticStoreError";
    this.reasonCode = reasonCode;
    this.details = details;
  }
}

export interface SemanticStoreLimits {
  readonly maxManifestBytes: number;
  readonly maxTotalManifestBytes: number;
  readonly maxManifestCount: number;
  readonly maxManifestDepth: number;
  readonly maxSourceCount: number;
  readonly maxSourceBytes: number;
  readonly maxTotalSourceBytes: number;
  readonly maxDatasetQuads: number;
  readonly maxQueryBytes: number;
  readonly maxQueryResults: number;
  readonly maxShaclResults: number;
  readonly canonicalizationTimeoutMs: number;
}

export interface SemanticSnapshot {
  readonly semanticDigest: string;
  readonly canonicalNQuads: string;
  readonly quadCount: number;
  readonly graphNames: readonly string[];
  readonly graphDigests: Readonly<Record<string, string>>;
  readonly sourceDigests: Readonly<Record<string, string>>;
}

export interface SemanticTerm {
  readonly termType: string;
  readonly value: string;
  readonly language?: string;
  readonly datatype?: string;
}

export interface SelectResult {
  readonly type: "select";
  readonly rows: readonly Readonly<Record<string, SemanticTerm>>[];
  readonly limit: number;
}

export interface AskResult {
  readonly type: "ask";
  readonly value: boolean;
}

export interface ConstructResult {
  readonly type: "construct";
  readonly canonicalNQuads: string;
  readonly quadCount: number;
  readonly limit: number;
}

export type SemanticQueryResult = SelectResult | AskResult | ConstructResult;

export interface ShaclResult {
  readonly focusNode: SemanticTerm;
  readonly path?: SemanticTerm;
  readonly severity: SemanticTerm;
  readonly sourceConstraintComponent: SemanticTerm;
  readonly sourceShape: SemanticTerm;
  readonly messages: readonly string[];
}

export interface ShaclReport {
  readonly conforms: boolean;
  readonly results: readonly ShaclResult[];
  readonly resultCount: number;
  readonly truncated: boolean;
}

/** Replaceable semantic persistence/query boundary; no implementation owns semantic authority. */
export interface SemanticStore {
  snapshot(): SemanticSnapshot;
  query(sparql: string, options?: { readonly maxResults?: number }): Promise<SemanticQueryResult>;
  validateShacl(options: {
    readonly shapeGraphs: readonly string[];
    readonly dataGraphs: readonly string[];
    readonly maxResults?: number;
  }): Promise<ShaclReport>;
}
