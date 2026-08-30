import { objectValues, objectsFor, resourceDigest, type SemanticGraph } from "./index.ts";

const typePredicate = "urn:usf:predicate:type";
const contractType = "urn:usf:type:SemanticContract";
const workType = "urn:usf:type:WorkPacket";

export interface Dependency {
  key: string;
  digest: string;
  kind: "semantic-resource" | "semantic-graph" | "file" | "manifest" | "policy" | "schema" | "tool";
}
export interface QueryOptions { iri?: string; contract?: string; selector?: string; maxItems?: number; }
export interface BoundedQueryResult {
  schema: "urn:usf:query-result:1";
  status: "ok" | "refused";
  reasonCode?: string;
  semanticDigest?: string;
  dependencyManifest?: Dependency[];
  items?: Array<Record<string, unknown>>;
  truncation?: { maxItems: number; returnedItems: number; truncated: boolean };
}

function limit(value: number | undefined): number | undefined {
  if (value === undefined) return 20;
  return Number.isSafeInteger(value) && value > 0 && value <= 100 ? value : undefined;
}
/** Generic kernel projection: contracts are discovered by typed graph data, never by product-specific IRIs. */
export function semanticContracts(graph: SemanticGraph): string[] {
  return [...new Set(graph.quads.filter((quad) => quad.predicate === typePredicate && quad.object === contractType).map((quad) => quad.subject))].sort();
}
function dataFor(graph: SemanticGraph, iri: string): Record<string, unknown> {
  const fields = objectsFor(graph, iri).map((quad) => ({ predicate: quad.predicate, value: quad.object, valueKind: quad.objectKind }));
  return { iri, fields };
}
function dependencies(graph: SemanticGraph, iris: string[], enumeration: boolean): Dependency[] {
  const graphDependencies = enumeration
    ? Object.entries(graph.graphDigests).map(([key, digest]) => ({ key, digest, kind: "semantic-graph" as const }))
    : [];
  const resources = iris.map((iri) => ({ key: iri, digest: resourceDigest(graph, iri), kind: "semantic-resource" as const }));
  return [...graphDependencies, ...resources].sort((left, right) => left.key.localeCompare(right.key));
}
function resolveSelector(graph: SemanticGraph, options: QueryOptions): { iris: string[]; enumeration: boolean } | { reason: string } {
  const provided = [options.iri, options.contract, options.selector].filter((value) => value !== undefined);
  if (provided.length !== 1) return { reason: "QUERY_SELECTOR_REQUIRED" };
  if (options.iri !== undefined) return graph.quads.some((quad) => quad.subject === options.iri) ? { iris: [options.iri], enumeration: false } : { reason: "QUERY_IRI_UNKNOWN" };
  if (options.contract !== undefined) {
    const isContract = graph.quads.some((quad) => quad.subject === options.contract && quad.predicate === typePredicate && quad.object === contractType);
    return isContract ? { iris: [options.contract], enumeration: false } : { reason: "QUERY_CONTRACT_UNKNOWN" };
  }
  if (options.selector === "contracts") return { iris: semanticContracts(graph), enumeration: true };
  if (options.selector === "work") return { iris: graph.quads.filter((quad) => quad.predicate === typePredicate && quad.object === workType).map((quad) => quad.subject).sort(), enumeration: true };
  return { reason: "QUERY_SELECTOR_UNKNOWN" };
}

/** Bounded graph projection; SPARQL and all mutation syntax are intentionally unsupported in bootstrap. */
export function queryGraph(graph: SemanticGraph, options: QueryOptions): BoundedQueryResult {
  const maxItems = limit(options.maxItems);
  if (maxItems === undefined) return { schema: "urn:usf:query-result:1", status: "refused", reasonCode: "QUERY_MAX_ITEMS_INVALID" };
  const selected = resolveSelector(graph, options);
  if ("reason" in selected) return { schema: "urn:usf:query-result:1", status: "refused", reasonCode: selected.reason };
  const items = selected.iris.slice(0, maxItems).map((iri) => dataFor(graph, iri));
  return {
    schema: "urn:usf:query-result:1", status: "ok", semanticDigest: graph.semanticDigest,
    dependencyManifest: dependencies(graph, selected.iris, selected.enumeration), items,
    truncation: { maxItems, returnedItems: items.length, truncated: selected.iris.length > items.length },
  };
}

export function contractRequirements(graph: SemanticGraph, contract: string): string[] { return objectValues(graph, contract, "urn:usf:predicate:requires"); }
export function contractNonClaims(graph: SemanticGraph, contract: string): string[] { return objectValues(graph, contract, "urn:usf:predicate:nonClaim"); }
export function contractWrites(graph: SemanticGraph, contract: string): string[] { return objectValues(graph, contract, "urn:usf:predicate:permitsWrite"); }
