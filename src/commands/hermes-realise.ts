import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { canonicalDigest } from "../core/canonical.ts";
import { exitCodes, UsfError } from "../core/errors.ts";
import { loadSemanticGraph, type SemanticGraph } from "../graph/index.ts";
import {
  lookupSemanticResult, recordSemanticReuse, semanticCacheStatistics, storeSemanticResult,
  type SemanticWorkIdentity,
} from "../providers/semantic-cache.ts";
import type { CommandResult } from "./dispatcher.ts";

/**
 * Derive the realization frontier from delivery authority and realize it.
 *
 * A delivery capability is not a unit of work. Work is derived from the
 * artefacts a capability requires, so one capability may expose several
 * independent units, one unit, or none at all when its artefacts already
 * satisfy their requirements. Nothing is pre-authored: the frontier is
 * recomputed from the graph on every invocation.
 */
const P = "urn:usf:predicate:";
const maximumBatch = 32;

export interface ArtefactWork {
  readonly artefact: string;
  readonly canonicalName: string;
  readonly artefactKind: string | null;
  /** Derived from graph authority, never proposed by a model. */
  readonly canonicalPath: string | null;
  readonly pathPattern: string | null;
  readonly generator: string | null;
  readonly mechanism: string;
  readonly mechanismReason: string | null;
  readonly owningRepository: string | null;
  readonly acceptanceFacets: readonly string[];
}

function one(graph: SemanticGraph, subject: string, predicate: string): string | null {
  const values = graph.quads.filter((quad) => quad.subject === subject && quad.predicate === `${P}${predicate}`);
  return values.length === 1 ? values[0]!.object : null;
}
function many(graph: SemanticGraph, subject: string, predicate: string): readonly string[] {
  return Object.freeze([...new Set(graph.quads
    .filter((quad) => quad.subject === subject && quad.predicate === `${P}${predicate}`)
    .map((quad) => quad.object))].sort());
}
function subjectsOfType(graph: SemanticGraph, type: string): readonly string[] {
  return Object.freeze(graph.quads
    .filter((quad) => quad.predicate === `${P}type` && quad.object === type)
    .map((quad) => quad.subject).sort());
}

/** Every artefact the delivery graph plans, with its realization rule. */
export function deriveArtefactWork(graph: SemanticGraph): readonly ArtefactWork[] {
  const planOwner = new Map<string, string>();
  const realisationRoot = new Map<string, string>();
  for (const repository of subjectsOfType(graph, "urn:usf:type:DeliveryRepository")) {
    const root = one(graph, repository, "realisationRoot");
    if (root !== null) realisationRoot.set(repository, root);
  }
  for (const plan of subjectsOfType(graph, "urn:usf:type:DeliveryArtefactPlan")) {
    const artefact = one(graph, plan, "plansArtefact");
    const repository = one(graph, plan, "ownedByRepository");
    if (artefact !== null) planOwner.set(artefact, repository ?? "");
  }
  return Object.freeze(subjectsOfType(graph, "urn:usf:type:DeliveryArtefact").map((artefact) => {
    const rule = one(graph, artefact, "governedByPathRule");
    return Object.freeze({
      artefact,
      canonicalName: one(graph, artefact, "canonicalName") ?? artefact.split(":").pop()!,
      artefactKind: one(graph, artefact, "artefactKind"),
      // Path comes from the artefact's own canonicalPath, and its governing
      // rule is carried so a realized file can be checked against the rule.
      // The path is the owning repository's declared realisation root joined
      // with the artefact path the graph states. Nothing invents a location.
      canonicalPath: ((): string | null => {
        const stated = one(graph, artefact, "canonicalPath");
        if (stated === null) return null;
        const root = realisationRoot.get(planOwner.get(artefact) ?? "");
        return root === undefined ? null : `${root}/${stated}`;
      })(),
      pathPattern: rule === null ? null : one(graph, rule, "pathPattern"),
      generator: one(graph, artefact, "generatedByComponent"),
      mechanism: one(graph, artefact, "realizationMechanism") ?? "SEMANTIC_MODEL_WORK",
      mechanismReason: one(graph, artefact, "realizationMechanismReason"),
      owningRepository: planOwner.get(artefact) ?? null,
      acceptanceFacets: many(graph, artefact, "acceptanceFacet"),
    });
  }));
}

/**
 * Deterministic realization for the generator classes whose entire input is
 * graph authority. A model is never called for these: the graph is the input
 * and the mapping is total, so a model could only paraphrase authority.
 */
export function generateDeterministically(
  graph: SemanticGraph,
  work: ArtefactWork,
): Readonly<{ content: string; inputDigests: readonly string[] }> | null {
  const generator = work.generator?.split(":").pop() ?? null;
  if (generator === "contractprojection") {
    // A total projection of authority is only a correct artefact when the target
    // format is the projection's own. An OpenAPI document and a GraphQL schema
    // need format-specific projection, which is not implemented, so they are
    // not realized here rather than realized wrongly.
    const jsonProjectable = work.canonicalPath !== null
      && (work.canonicalPath.endsWith(".json") || work.canonicalPath.endsWith(".schema.json"));
    if (!jsonProjectable) return null;
    // Project the delivery contracts and their facets, which is exactly what a
    // contract projection is: authority rendered into a consumable document.
    const contracts = subjectsOfType(graph, "urn:usf:type:DeliveryContract").map((contract) => Object.freeze({
      contract,
      canonicalName: one(graph, contract, "canonicalName"),
      definesCompletionFor: one(graph, contract, "definesCompletionFor"),
      facets: many(graph, contract, "declaresFacet"),
    }));
    const body = Object.freeze({
      schema: "urn:usf:contract-projection:1",
      projectedArtefact: work.artefact,
      artefactKind: work.artefactKind,
      contractCount: contracts.length,
      contracts,
      nonClaims: [
        "This document is a total projection of delivery-contract authority. It introduces no fact the graph does not already state.",
        "It asserts no contract is satisfied.",
      ],
    });
    return Object.freeze({
      content: `${JSON.stringify(body, null, 2)}\n`,
      inputDigests: Object.freeze(contracts.map((entry) => canonicalDigest(entry)).sort()),
    });
  }
  if (generator === "runtime") {
    // Compose the runtime from the captured service, provider, port and mode graph.
    const services = subjectsOfType(graph, "urn:usf:type:DeliveryService").map((service) => Object.freeze({
      service, canonicalName: one(graph, service, "canonicalName"),
      servesCapability: one(graph, service, "servesCapability"),
    }));
    const providers = subjectsOfType(graph, "urn:usf:type:DeliveryProvider").map((provider) => Object.freeze({
      provider, canonicalName: one(graph, provider, "canonicalName"),
      fulfilsPort: one(graph, provider, "fulfilsPort"),
      providerMode: one(graph, provider, "hasProviderMode"),
    }));
    const body = Object.freeze({
      schema: "urn:usf:runtime-composition:1",
      projectedArtefact: work.artefact,
      serviceCount: services.length, providerCount: providers.length,
      services, providers,
      nonClaims: [
        "This composition states which provider fulfils which port in which mode. It provisions nothing and asserts no service is running.",
      ],
    });
    return Object.freeze({
      content: `${JSON.stringify(body, null, 2)}\n`,
      inputDigests: Object.freeze([...services, ...providers].map((entry) => canonicalDigest(entry)).sort()),
    });
  }
  return null;
}

export interface RealisePlan {
  readonly schema: "urn:usf:delivery-realisation-plan:1";
  readonly version: 1;
  readonly evaluated: true;
  readonly capabilityCount: number;
  readonly artefactWorkCount: number;
  readonly deterministicCount: number;
  readonly semanticModelCount: number;
  readonly alreadySatisfiedCount: number;
  readonly readyFrontier: number;
  readonly hardDependencyEdges: number;
  readonly integrationValidationEdges: number;
  readonly work: readonly ArtefactWork[];
}

export async function realisePlanCommand(repositoryRoot: string, args: readonly string[]): Promise<CommandResult> {
  const apply = args.includes("--apply");
  const envFileIndex = args.indexOf("--env-file");
  const envFile = envFileIndex >= 0 ? args[envFileIndex + 1] : undefined;
  for (const argument of args) {
    if (!["--apply", "--env-file", envFile ?? ""].includes(argument) && !argument.startsWith(".usf/")) {
      throw new UsfError("HERMES_REALISE_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT,
        "Realise accepts only --apply and --env-file.", { argument });
    }
  }
  const graph = loadSemanticGraph(repositoryRoot, "graph/manifests/v3-delivery.json");
  const capabilities = subjectsOfType(graph, "urn:usf:type:DeliveryCapability");
  const work = deriveArtefactWork(graph);

  // Already satisfied: the artefact exists at its canonical path.
  const satisfied = new Set<string>();
  for (const entry of work) {
    if (entry.canonicalPath === null) continue;
    const bytes = await readFile(resolve(repositoryRoot, entry.canonicalPath), "utf8").catch(() => undefined);
    if (bytes !== undefined) satisfied.add(entry.artefact);
  }
  const pending = work.filter((entry) => !satisfied.has(entry.artefact));
  const deterministic = pending.filter((entry) => entry.mechanism === "DETERMINISTIC_GENERATOR");
  const semantic = pending.filter((entry) => entry.mechanism !== "DETERMINISTIC_GENERATOR");
  const hardEdges = graph.quads.filter((quad) => quad.predicate === `${P}dependsOn`
    && quad.subject.startsWith("urn:usf:delivery-capability:")).length;
  const integrationEdges = graph.quads.filter((quad) => quad.predicate === `${P}integrationValidationDependency`).length;

  const plan: RealisePlan = Object.freeze({
    schema: "urn:usf:delivery-realisation-plan:1" as const,
    version: 1 as const,
    evaluated: true as const,
    capabilityCount: capabilities.length,
    artefactWorkCount: work.length,
    deterministicCount: deterministic.length,
    semanticModelCount: semantic.length,
    alreadySatisfiedCount: satisfied.size,
    // Every pending unit is ready: no artefact is ordered by another.
    readyFrontier: pending.length,
    hardDependencyEdges: hardEdges,
    integrationValidationEdges: integrationEdges,
    work: Object.freeze(pending),
  });

  if (!apply) {
    return { output: Object.freeze({ ...plan, cache: await semanticCacheStatistics(repositoryRoot) }), exitCode: exitCodes.SUCCESS };
  }

  // Realize the deterministic frontier. Every unit is independent, so results
  // are computed together and batched into one transaction.
  const realized: Array<Readonly<{ artefact: string; path: string; mechanism: string; cache: string; digest: string }>> = [];
  const postimages: Array<Readonly<{ path: string; content: string }>> = [];
  const policyDigest = canonicalDigest(graph.graphDigests ?? {});
  for (const entry of deterministic) {
    if (entry.canonicalPath === null) continue;
    const generated = generateDeterministically(graph, entry);
    if (generated === null) continue;
    const identity: SemanticWorkIdentity = Object.freeze({
      requirement: entry.artefact,
      inputDigests: generated.inputDigests,
      dependencyResultDigests: Object.freeze([]),
      acceptanceRequirements: entry.acceptanceFacets,
      requiredCapabilities: Object.freeze([]),
      outputContract: entry.artefactKind,
      policyDigest,
      requiredProvider: null,
      requiredModel: null,
    });
    const lookup = await lookupSemanticResult(repositoryRoot, identity);
    let content: string;
    let cacheState: string;
    if (lookup.hit && lookup.entry !== null) {
      content = lookup.entry.text;
      cacheState = "reused";
      await recordSemanticReuse(repositoryRoot, lookup.entry);
    } else {
      content = generated.content;
      cacheState = "produced";
      // A deterministic result is cached too: it is still semantic work whose
      // repetition wastes effort, even though it costs no model tokens.
      await storeSemanticResult(repositoryRoot, identity, content, null);
    }
    postimages.push(Object.freeze({ path: entry.canonicalPath, content }));
    realized.push(Object.freeze({
      artefact: entry.artefact, path: entry.canonicalPath, mechanism: entry.mechanism,
      cache: cacheState, digest: canonicalDigest(content),
    }));
    if (postimages.length >= maximumBatch) break;
  }

  // Independent realizations are batched into one proposal and applied through
  // the single semantic transaction path. Nothing is written here, so a refused
  // batch leaves nothing partially realized.
  let proposalPath: string | null = null;
  if (postimages.length > 0) {
    const proposal = Object.freeze({
      schema: "urn:usf:semantic-transaction-proposal:1" as const,
      intent: `Realize ${postimages.length} independent delivery artefacts derived from delivery authority.`,
      declaredAffectedPaths: Object.freeze([...postimages.map((entry) => entry.path)].sort()),
      operations: Object.freeze(postimages.map((entry) => Object.freeze({
        kind: "write-file" as const, path: entry.path, content: entry.content, preimageDigest: null,
      }))),
    });
    const directory = resolve(repositoryRoot, ".usf", "proposals");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    proposalPath = ".usf/proposals/delivery-realisation.json";
    await writeFile(resolve(repositoryRoot, proposalPath), `${JSON.stringify(proposal, null, 2)}\n`, { mode: 0o600 });
  }

  return {
    output: Object.freeze({
      ...plan,
      proposalPath,
      batchSize: postimages.length,
      realizedCount: realized.length,
      realized: Object.freeze(realized),
      // The caller batches these into one transaction; realise computes, it does
      // not mutate, so a failed batch leaves nothing partially written.
      proposedPostimages: Object.freeze(postimages.map((entry) => Object.freeze({
        path: entry.path, contentDigest: canonicalDigest(entry.content),
      }))),
      cache: await semanticCacheStatistics(repositoryRoot),
    }),
    exitCode: exitCodes.SUCCESS,
  };
}
