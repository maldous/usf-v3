import { Store as OxigraphStore, type Term } from "oxigraph";
import { canonicalizeDataset } from "./canonical.ts";
import {
  SemanticStoreError,
  semanticReasonCodes,
  type SemanticQueryResult,
  type SemanticTerm,
} from "./types.ts";

const updateKeywords = new Set(["ADD", "CLEAR", "COPY", "CREATE", "DELETE", "DROP", "INSERT", "LOAD", "MOVE", "WITH"]);

interface Token { readonly value: string; readonly depth: number; }

/** Removes comments, IRIs and quoted strings before security keyword inspection. */
function lexicalTokens(sparql: string): Token[] {
  const tokens: Token[] = [];
  let depth = 0;
  let index = 0;
  while (index < sparql.length) {
    const character = sparql[index] as string;
    if (character === "#") {
      while (index < sparql.length && sparql[index] !== "\n" && sparql[index] !== "\r") index += 1;
      continue;
    }
    if (character === "<") {
      index += 1;
      while (index < sparql.length) {
        if (sparql[index] === "\\") index += 2;
        else if (sparql[index] === ">") { index += 1; break; }
        else index += 1;
      }
      continue;
    }
    if (character === "\"" || character === "'") {
      const quote = character;
      const triple = sparql.slice(index, index + 3) === quote.repeat(3);
      index += triple ? 3 : 1;
      while (index < sparql.length) {
        if (sparql[index] === "\\") index += 2;
        else if (triple && sparql.slice(index, index + 3) === quote.repeat(3)) { index += 3; break; }
        else if (!triple && sparql[index] === quote) { index += 1; break; }
        else index += 1;
      }
      continue;
    }
    if (character === "{") { depth += 1; index += 1; continue; }
    if (character === "}") { depth = Math.max(0, depth - 1); index += 1; continue; }
    if ((character === "?" || character === "$") && /[A-Za-z_]/u.test(sparql[index + 1] as string)) {
      index += 2;
      while (index < sparql.length && /[A-Za-z0-9_-]/u.test(sparql[index] as string)) index += 1;
      continue;
    }
    if (/[A-Za-z_]/u.test(character)) {
      const start = index;
      index += 1;
      while (index < sparql.length && /[A-Za-z0-9_-]/u.test(sparql[index] as string)) index += 1;
      tokens.push({ value: sparql.slice(start, index).toUpperCase(), depth });
      continue;
    }
    if (/[0-9]/u.test(character)) {
      const start = index;
      index += 1;
      while (index < sparql.length && /[0-9]/u.test(sparql[index] as string)) index += 1;
      tokens.push({ value: sparql.slice(start, index), depth });
      continue;
    }
    index += 1;
  }
  return tokens;
}

function preflight(
  sparql: string,
  limits: { readonly maxQueryBytes: number; readonly maxQueryResults: number },
  requestedMax: number | undefined,
): { readonly form: "SELECT" | "ASK" | "CONSTRUCT"; readonly limit?: number; readonly maxResults: number } {
  if (Buffer.byteLength(sparql, "utf8") === 0 || Buffer.byteLength(sparql, "utf8") > limits.maxQueryBytes) {
    throw new SemanticStoreError(semanticReasonCodes.QUERY_INVALID, "The SPARQL query is empty or exceeds the query byte limit.");
  }
  const maxResults = requestedMax ?? limits.maxQueryResults;
  if (!Number.isSafeInteger(maxResults) || maxResults < 1 || maxResults > limits.maxQueryResults) {
    throw new SemanticStoreError(semanticReasonCodes.QUERY_LIMIT_REFUSED, "The requested result bound is outside the configured limit.");
  }
  const tokens = lexicalTokens(sparql);
  if (tokens.some((token) => updateKeywords.has(token.value))) {
    throw new SemanticStoreError(semanticReasonCodes.QUERY_UPDATE_REFUSED, "SPARQL Update is not available through the read-only semantic store.");
  }
  if (tokens.some((token) => token.value === "SERVICE")) {
    throw new SemanticStoreError(semanticReasonCodes.QUERY_SERVICE_REFUSED, "SPARQL SERVICE is prohibited in the repository-contained store.");
  }
  if (tokens.some((token) => token.value === "FROM")) {
    throw new SemanticStoreError(semanticReasonCodes.QUERY_REMOTE_GRAPH_REFUSED, "SPARQL dataset loading clauses are prohibited; query manifest-loaded named graphs instead.");
  }
  const formToken = tokens.find((token) => token.depth === 0 && ["SELECT", "ASK", "CONSTRUCT", "DESCRIBE"].includes(token.value));
  if (formToken === undefined || formToken.value === "DESCRIBE") {
    throw new SemanticStoreError(semanticReasonCodes.QUERY_FORM_REFUSED, "Only SELECT, ASK and CONSTRUCT queries are supported.");
  }
  const form = formToken.value as "SELECT" | "ASK" | "CONSTRUCT";
  if (form === "ASK") return { form, maxResults };
  const topLevelLimits = tokens.flatMap((token, tokenIndex) => token.depth === 0 && token.value === "LIMIT" ? [tokens[tokenIndex + 1]] : []);
  if (topLevelLimits.length !== 1 || topLevelLimits[0] === undefined || !/^\d+$/u.test(topLevelLimits[0].value)) {
    throw new SemanticStoreError(semanticReasonCodes.QUERY_UNBOUNDED_REFUSED, "SELECT and CONSTRUCT require one explicit top-level LIMIT.");
  }
  const declaredLimit = Number(topLevelLimits[0].value);
  if (!Number.isSafeInteger(declaredLimit) || declaredLimit < 1 || declaredLimit > maxResults) {
    throw new SemanticStoreError(semanticReasonCodes.QUERY_LIMIT_REFUSED, "The query LIMIT exceeds the requested or configured result bound.", { declaredLimit, maxResults });
  }
  return { form, limit: declaredLimit, maxResults };
}

function termToJson(term: Term): SemanticTerm {
  return {
    termType: term.termType,
    value: term.value,
    ...(term.termType === "Literal" && "language" in term && term.language !== "" ? { language: term.language } : {}),
    ...(term.termType === "Literal" && "datatype" in term ? { datatype: term.datatype.value } : {}),
  };
}

export async function queryLocalStore(
  store: OxigraphStore,
  sparql: string,
  options: {
    readonly maxResults?: number;
    readonly maxQueryBytes: number;
    readonly maxQueryResults: number;
    readonly canonicalizationTimeoutMs: number;
  },
): Promise<SemanticQueryResult> {
  const checked = preflight(sparql, options, options.maxResults);
  let raw: ReturnType<OxigraphStore["query"]>;
  try {
    raw = store.query(sparql);
  } catch (error) {
    throw new SemanticStoreError(semanticReasonCodes.QUERY_INVALID, "Oxigraph rejected the SPARQL query.", { cause: error instanceof Error ? error.message : "unknown" });
  }
  if (checked.form === "ASK") {
    if (typeof raw !== "boolean") throw new SemanticStoreError(semanticReasonCodes.QUERY_INVALID, "The query result did not match the ASK form.");
    return { type: "ask", value: raw };
  }
  if (!Array.isArray(raw)) throw new SemanticStoreError(semanticReasonCodes.QUERY_INVALID, "The query result did not match its declared form.");
  if (raw.length > checked.maxResults) {
    throw new SemanticStoreError(semanticReasonCodes.QUERY_RESULT_LIMIT_EXCEEDED, "Oxigraph returned more results than the enforced bound.");
  }
  if (checked.form === "SELECT") {
    const rows = (raw as Map<string, Term>[]).map((binding) => Object.fromEntries(
      [...binding.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([name, term]) => [name, termToJson(term)]),
    ));
    return { type: "select", rows, limit: checked.limit as number };
  }
  const quads = raw as import("oxigraph").Quad[];
  const canonical = await canonicalizeDataset(quads, { timeoutMs: options.canonicalizationTimeoutMs });
  const quadCount = canonical.canonicalNQuads === "" ? 0 : canonical.canonicalNQuads.trimEnd().split("\n").length;
  if (quadCount > checked.maxResults) {
    throw new SemanticStoreError(semanticReasonCodes.QUERY_RESULT_LIMIT_EXCEEDED, "The CONSTRUCT result exceeded the enforced bound.", { quadCount, maxResults: checked.maxResults });
  }
  return { type: "construct", canonicalNQuads: canonical.canonicalNQuads, quadCount, limit: checked.limit as number };
}
