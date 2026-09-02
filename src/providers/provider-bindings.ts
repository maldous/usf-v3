import type { SemanticGraph } from "../graph/index.ts";

/**
 * Provider facts the models.dev projection cannot supply, recovered from V2 and
 * declared in graph authority: the endpoint an OpenAI-compatible adapter needs,
 * and credential variable names the catalogue renamed.
 */
const P = "urn:usf:predicate:";
const aliasType = "urn:usf:type:CredentialNameAlias";
const endpointType = "urn:usf:type:ProviderEndpoint";

export interface ProviderBindings {
  /** provider route -> base URL for an OpenAI-compatible adapter. */
  readonly endpoints: ReadonlyMap<string, string>;
  /** provider route -> additional credential names that also supply it. */
  readonly credentialAliases: ReadonlyMap<string, readonly string[]>;
  /**
   * Transports the operator has authored a dispatch preference for: tried ahead
   * of unpreferred routes when not deferred. It is a preference, not an
   * override -- a preferred route that produces nothing admissible still stands
   * down at the ceiling, so promotion cannot become runaway spend.
   */
  readonly preferredTransports: ReadonlySet<string>;
  /**
   * Transport IRI local name -> every model that transport may request.
   *
   * A host-agent transport commonly serves several models under one
   * subscription, each with its own quota. Carrying only one made the whole
   * transport unavailable the moment that single model was exhausted, even
   * though the subscription still answered on another.
   */
  readonly transportSelectedModel: ReadonlyMap<string, readonly string[]>;
  readonly declared: boolean;
}

function subjectsOfType(graph: SemanticGraph, type: string): readonly string[] {
  return Object.freeze(graph.quads
    .filter((quad) => quad.predicate === `${P}type` && quad.object === type)
    .map((quad) => quad.subject)
    .sort());
}
function one(graph: SemanticGraph, subject: string, predicate: string): string | null {
  const values = graph.quads.filter((quad) => quad.subject === subject && quad.predicate === `${P}${predicate}`);
  return values.length === 1 ? values[0]!.object : null;
}

export function readProviderBindings(graph: SemanticGraph): ProviderBindings {
  const endpoints = new Map<string, string>();
  for (const subject of subjectsOfType(graph, endpointType)) {
    const provider = one(graph, subject, "provider");
    const baseUrl = one(graph, subject, "baseUrl");
    if (provider !== null && baseUrl !== null) endpoints.set(provider, baseUrl);
  }
  const credentialAliases = new Map<string, readonly string[]>();
  for (const subject of subjectsOfType(graph, aliasType)) {
    const provider = one(graph, subject, "provider");
    const established = one(graph, subject, "establishedCredentialName");
    if (provider === null || established === null) continue;
    credentialAliases.set(provider, Object.freeze([...(credentialAliases.get(provider) ?? []), established]));
  }
  const preferredTransports = new Set<string>();
  for (const quad of graph.quads) {
    if (quad.predicate !== `${P}operatorPreferredForDispatch` || quad.object !== "true") continue;
    if (quad.subject.startsWith("urn:usf:execution-transport:")) {
      preferredTransports.add(quad.subject.slice("urn:usf:execution-transport:".length));
    }
  }
  const transportSelectedModel = new Map<string, readonly string[]>();
  for (const quad of graph.quads) {
    if (quad.predicate !== `${P}selectedModel`) continue;
    const name = quad.subject.startsWith("urn:usf:execution-transport:")
      ? quad.subject.slice("urn:usf:execution-transport:".length)
      : null;
    if (name === null) continue;
    transportSelectedModel.set(name,
      Object.freeze([...new Set([...(transportSelectedModel.get(name) ?? []), quad.object])].sort()));
  }
  return Object.freeze({
    endpoints,
    credentialAliases,
    preferredTransports,
    transportSelectedModel,
    declared: endpoints.size > 0 || credentialAliases.size > 0,
  });
}

/** Every credential name that legitimately supplies a provider. */
export function effectiveCredentialNames(
  bindings: ProviderBindings,
  provider: string,
  catalogueNames: readonly string[],
): readonly string[] {
  return Object.freeze([...new Set([...catalogueNames, ...(bindings.credentialAliases.get(provider) ?? [])])].sort());
}
