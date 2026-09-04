import { loadCorpusObservations } from "../providers/architecture-observation.ts";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { canonicalDigest } from "../core/canonical.ts";
import { canonicalQuadLine } from "../graph/nquads.ts";
import { validateArtefactOutput } from "../providers/artefact-validation.ts";
import { allEvidenceClasses, evaluateFacets, summariseFacets, type EvidenceIndex } from "../providers/facet-evaluation.ts";
import { loadConformanceEvidence } from "../providers/implementation-conformance.ts";
import { deterministicGenerators, projectByFormat, validateGeneratedFormat } from "../providers/delivery-generators.ts";
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
  if (work.canonicalPath !== null) {
    const generatorInput = Object.freeze({
      graph, canonicalName: work.canonicalName, artefactKind: work.artefactKind,
      canonicalPath: work.canonicalPath, realizedPaths: Object.freeze([] as readonly string[]),
    });
    // Format-specific projectors are selected by declared target format, since
    // one generator class serves several formats.
    const projected = projectByFormat(generatorInput);
    if (projected !== null) {
      return projected.blocker === null
        ? Object.freeze({ content: projected.content, inputDigests: projected.inputDigests })
        : null;
    }
    const registered = generator === null ? undefined : deterministicGenerators[generator];
    if (registered !== undefined) {
      const produced = registered(generatorInput);
      return produced.blocker === null
        ? Object.freeze({ content: produced.content, inputDigests: produced.inputDigests })
        : null;
    }
  }
  if (generator === "contractprojection") {
    // A total projection of authority is only a correct artefact when the target
    // format is the projection's own. An OpenAPI document, a GraphQL schema and
    // a JSON Schema each have their own required shape; emitting a projection
    // into those paths yields a syntactically wrong artefact. Only a manifest
    // target accepts the projection directly.
    const kind = work.artefactKind?.split(":").pop() ?? null;
    if (kind !== "manifest") return null;
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
  if (generator === "release") {
    // Release artefacts are computed from the realized artefact set. A model
    // cannot compute a checksum, and a signature requires a key this repository
    // deliberately does not hold, so the signature artefact is not produced here.
    const name = work.canonicalName;
    if (name === "releasesignature") return null;
    const realized = graph.quads
      .filter((quad) => quad.predicate === `${P}canonicalPath` && quad.subject.startsWith("urn:usf:delivery-artefact:"))
      .map((quad) => Object.freeze({ artefact: quad.subject, path: quad.object }))
      .sort((left, right) => left.path.localeCompare(right.path));
    const body = name === "releasechecksums"
      ? Object.freeze({
          schema: "urn:usf:release-checksums:1", algorithm: "sha256-usf-canonical-json-v1",
          entryCount: realized.length, entries: realized,
          nonClaims: ["Digests are computed over declared artefact identity, not over bytes that may not yet exist."],
        })
      : name === "softwarebillofmaterials"
      ? Object.freeze({
          schema: "urn:usf:software-bill-of-materials:1", componentCount: realized.length,
          components: realized.map((entry) => Object.freeze({ artefact: entry.artefact, path: entry.path })),
          nonClaims: ["This bill enumerates declared delivery artefacts. It asserts no third-party dependency inventory."],
        })
      : name === "provenancerecord"
      ? Object.freeze({
          schema: "urn:usf:provenance-record:1",
          derivedFrom: "delivery authority", artefactCount: realized.length,
          nonClaims: ["Provenance states which artefacts the delivery graph declares. It asserts no build occurred."],
        })
      : Object.freeze({
          schema: "urn:usf:release-manifest:1", artefactCount: realized.length, artefacts: realized,
          nonClaims: ["A manifest enumerates declared artefacts. It asserts none is realized."],
        });
    return Object.freeze({
      content: `${JSON.stringify(body, null, 2)}\n`,
      inputDigests: Object.freeze(realized.map((entry) => canonicalDigest(entry)).sort()),
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

/**
 * The semantic requirement a model must satisfy, derived entirely from graph
 * authority. The model is told what the artefact means and what format it must
 * be in; it is never told, and never decides, where the file goes.
 */
export function deriveSemanticPrompt(graph: SemanticGraph, work: ArtefactWork): string {
  const kind = work.artefactKind?.split(":").pop() ?? "artefact";
  const format = work.canonicalPath?.endsWith(".md") === true ? "GitHub-flavoured Markdown"
    : work.canonicalPath?.endsWith(".json") === true ? "a single JSON object"
    : work.canonicalPath?.endsWith(".yml") === true || work.canonicalPath?.endsWith(".yaml") === true ? "YAML with a root mapping"
    : "plain text";
  const capability = graph.quads.find((quad) =>
    quad.predicate === `${P}definesCompletionFor` && quad.subject.startsWith("urn:usf:delivery-contract:"))?.object ?? null;
  const facets = work.acceptanceFacets.length === 0 ? "" :
    `\nAcceptance facets that must be addressed: ${work.acceptanceFacets.map((facet) => facet.split(":").pop()).join(", ")}.`;
  return [
    `Produce the content of one delivery artefact for the ANQR product.`,
    `Artefact: ${work.canonicalName}. Declared kind: ${kind}.`,
    `Output format: ${format}. Return only the content, with no commentary, no code fence and no file path.`,
    capability === null ? "" : `It belongs to the delivery capability set of this product.`,
    facets,
    `Be concise and concrete. Do not invent repository paths, filenames or additional files.`,
  ].filter((line) => line.length > 0).join("\n");
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
  /** Derived artefacts on disk that no longer equal what authority projects. */
  readonly driftedArtefacts: readonly string[];
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

  // Already satisfied: the artefact exists at its canonical path and, when it is
  // derived, still equals what its authority now projects.
  //
  // Presence alone is not satisfaction for a derived artefact. Its authority can
  // move after it was written, and nothing would ever re-derive it: the statement
  // of applicability went on reporting 45 undecided controls after all 45 had
  // been decided, because the file existed. A stale projection of a compliance
  // document is worse than an absent one, so drift is treated as pending.
  const satisfied = new Set<string>();
  const drifted: string[] = [];
  for (const entry of work) {
    if (entry.canonicalPath === null) continue;
    const bytes = await readFile(resolve(repositoryRoot, entry.canonicalPath), "utf8").catch(() => undefined);
    if (bytes === undefined) continue;
    if (entry.mechanism === "DETERMINISTIC_GENERATOR") {
      const current = generateDeterministically(graph, entry);
      if (current !== null && current.content !== bytes) { drifted.push(entry.artefact); continue; }
    }
    satisfied.add(entry.artefact);
  }
  drifted.sort();
  const notRealizable = Object.freeze(["SUPERSEDED", "BLOCKED_ON_AUTHORITY"]);
  const pending = work.filter((entry) =>
    !satisfied.has(entry.artefact) && !notRealizable.includes(entry.mechanism));
  const superseded = work.filter((entry) => entry.mechanism === "SUPERSEDED");
  const authorityBlocked = work.filter((entry) => entry.mechanism === "BLOCKED_ON_AUTHORITY");
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
    driftedArtefacts: Object.freeze(drifted),
    supersededCount: superseded.length,
    authorityBlockedCount: authorityBlocked.length,
    authorityBlocked: Object.freeze(authorityBlocked.map((entry) => Object.freeze({
      artefact: entry.artefact, reason: entry.mechanismReason,
    }))),
    // Every pending unit is ready: no artefact is ordered by another.
    readyFrontier: pending.length,
    hardDependencyEdges: hardEdges,
    integrationValidationEdges: integrationEdges,
    work: Object.freeze(pending),
  });

  // Facet satisfaction is derived from the evidence that exists now, never read
  // from a stored value.
  const realizedArtefacts = new Map<string, string>();
  for (const entry of work) {
    if (entry.canonicalPath === null || !satisfied.has(entry.artefact)) continue;
    const bytes = await readFile(resolve(repositoryRoot, entry.canonicalPath), "utf8").catch(() => undefined);
    if (bytes !== undefined) realizedArtefacts.set(entry.canonicalPath, canonicalDigest(bytes));
  }
  // Validator outcomes are read from durable evidence, never asserted here.
  const evidenceDirectory = resolve(repositoryRoot, ".usf", "validation-evidence");
  const evidenceNames = (await readdir(evidenceDirectory).catch(() => [] as string[]))
    .filter((name) => name.endsWith(".json")).sort();
  const validatorOutcomes: string[] = [];
  for (const name of evidenceNames) {
    const bytes = await readFile(resolve(evidenceDirectory, name), "utf8").catch(() => undefined);
    if (bytes === undefined) continue;
    try {
      const record = JSON.parse(bytes) as { outcomes?: Array<{ artefact?: unknown; valid?: unknown; validator?: unknown }> };
      for (const outcome of record.outcomes ?? []) {
        // Only a passing outcome is admissible evidence of validation.
        if (outcome.valid !== true || typeof outcome.artefact !== "string") continue;
        validatorOutcomes.push(`${outcome.artefact}@${String(outcome.validator)}`);
      }
    } catch { continue; }
  }
  const evidence: EvidenceIndex = Object.freeze({
    // Behavioural outcomes come from executed conformance runs, so the artefact
    // lane reports the same facet truth the implementation lane produces.
    conformanceOutcomes: await loadConformanceEvidence(repositoryRoot),
    // Corpus-scoped observations are durable records, so this lane reads the
    // same ones the implementation lane produced rather than claiming to
    // supply a class it never looked at.
    structuralObservations: await loadCorpusObservations(repositoryRoot),
    realizedArtefacts,
    runtimeComposed: [...realizedArtefacts.keys()].some((path) => path.endsWith("/runtime/compose.json")),
    validatorOutcomes: Object.freeze([...new Set(validatorOutcomes)].sort()),
    proofOutcomes: Object.freeze([]),
    // The artefact lane loads every evidence class, so nothing reads OTHER_LANE here.
    suppliedEvidenceClasses: allEvidenceClasses,
  });
  const facets = summariseFacets(evaluateFacets(graph, evidence));

  if (!apply) {
    return {
      output: Object.freeze({ ...plan, facets, cache: await semanticCacheStatistics(repositoryRoot) }),
      exitCode: exitCodes.SUCCESS,
    };
  }

  // Realize the deterministic frontier. Every unit is independent, so results
  // are computed together and batched into one transaction.
  const realized: Array<Readonly<{ artefact: string; path: string; mechanism: string; cache: string; digest: string }>> = [];
  const validationOutcomes: Array<Readonly<Record<string, unknown>>> = [];
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
    // A deterministic artefact is validated by the real tooling for its declared
    // format before acceptance, and the outcome is recorded as evidence the facet
    // evaluator can read. The evidence records that a validator ran and what it
    // returned; it never records satisfaction.
    const formatCheck = await validateGeneratedFormat(content, entry.canonicalPath);
    validationOutcomes.push(Object.freeze({
      artefact: entry.artefact, path: entry.canonicalPath,
      contentDigest: canonicalDigest(content),
      validator: formatCheck.validator, valid: formatCheck.valid,
      detail: formatCheck.detail, authoritySnapshot: policyDigest,
    }));
    if (!formatCheck.valid) continue;
    postimages.push(Object.freeze({ path: entry.canonicalPath, content }));
    realized.push(Object.freeze({
      artefact: entry.artefact, path: entry.canonicalPath, mechanism: entry.mechanism,
      cache: cacheState, digest: canonicalDigest(content),
    }));
    if (postimages.length >= maximumBatch) break;
  }

  // Semantic model work. The existing V3 execution path does the routing:
  // candidate discovery, capability filtering, transport compatibility,
  // authentication, economics, route selection, fallback and the authority
  // bracket. Realization adds only the semantic requirement and the output
  // check; it does not choose a provider and does not execute models itself.
  const modelWork = semantic.filter((entry) =>
    entry.mechanism === "SEMANTIC_MODEL_WORK" && entry.canonicalPath !== null);
  const modelOutcomes: Array<Readonly<Record<string, unknown>>> = [];
  let modelInvocations = 0;
  let cacheHits = 0;
  if (envFile !== undefined && modelWork.length > 0) {
    const dispatch: Array<Readonly<{ work: ArtefactWork; identity: SemanticWorkIdentity; unit: string; prompt: string }>> = [];
    for (const entry of modelWork.slice(0, maximumBatch)) {
      const prompt = deriveSemanticPrompt(graph, entry);
      const identity: SemanticWorkIdentity = Object.freeze({
        requirement: entry.artefact,
        inputDigests: Object.freeze([canonicalDigest(prompt)]),
        dependencyResultDigests: Object.freeze([]),
        acceptanceRequirements: entry.acceptanceFacets,
        requiredCapabilities: Object.freeze([]),
        outputContract: entry.artefactKind,
        policyDigest,
        requiredProvider: null,
        requiredModel: null,
      });
      const lookup = await lookupSemanticResult(repositoryRoot, identity);
      if (lookup.hit && lookup.entry !== null) {
        const checked = validateArtefactOutput(lookup.entry.text, {
          canonicalPath: entry.canonicalPath!, artefactKind: entry.artefactKind,
        });
        if (checked.accepted) {
          cacheHits += 1;
          await recordSemanticReuse(repositoryRoot, lookup.entry);
          postimages.push(Object.freeze({ path: entry.canonicalPath!, content: checked.content }));
          realized.push(Object.freeze({
            artefact: entry.artefact, path: entry.canonicalPath!, mechanism: entry.mechanism,
            cache: "reused", digest: checked.contentDigest,
          }));
          continue;
        }
      }
      dispatch.push(Object.freeze({
        work: entry, identity, prompt,
        unit: `urn:usf:workunit:realise-${entry.canonicalName}`,
      }));
    }

    if (dispatch.length > 0) {
      // One work graph, dispatched through the ordinary graph execution path so
      // every unit routes independently and refusals fall back per unit.
      const workGraph = "urn:usf:graph:delivery-realisation";
      const quads = dispatch.flatMap(({ unit, prompt }) => [
        { subject: unit, predicate: `${P}type`, object: "urn:usf:type:SemanticWorkUnit", objectKind: "iri" as const, graph: workGraph, canonical: "" },
        { subject: unit, predicate: `${P}prompt`, object: prompt, objectKind: "literal" as const, graph: workGraph, canonical: "" },
        { subject: unit, predicate: `${P}maximumOutputTokens`, object: "4000", objectKind: "literal" as const, graph: workGraph, canonical: "" },
      ]).map((quad) => ({ ...quad, canonical: canonicalQuadLine(quad) }));
      const workPath = ".usf/work/delivery-realisation.nq";
      await mkdir(resolve(repositoryRoot, ".usf", "work"), { recursive: true, mode: 0o700 });
      await writeFile(resolve(repositoryRoot, workPath),
        `${quads.map((quad) => quad.canonical).sort().join("\n")}\n`, { mode: 0o600 });
      const { graphExecuteCommand } = await import("./graph-execute.ts");
      const executed = await graphExecuteCommand(repositoryRoot, [
        "--input", workPath, "--graph", workGraph, "--env-file", envFile,
        "--concurrency", String(Math.min(8, dispatch.length)),
      ]).catch((error: unknown) => ({
        output: Object.freeze({ status: "refused", failure: error instanceof Error ? error.message.slice(0, 200) : "unknown" }),
        exitCode: exitCodes.EXTERNAL_UNAVAILABLE,
      }));
      const evidence = executed.output as Record<string, unknown>;
      const units = Array.isArray(evidence.units) ? evidence.units as Record<string, unknown>[] : [];
      const byUnit = new Map(units.map((unit) => [unit.unit as string, unit] as const));
      for (const { work: entry, identity, unit } of dispatch) {
        const record = byUnit.get(unit);
        if (record === undefined || record.status !== "ok" || typeof record.resultText !== "string") {
          modelOutcomes.push(Object.freeze({
            artefact: entry.artefact, outcome: "refused",
            reason: (record?.attempts as Array<{ reasonCode?: unknown }> | undefined)?.at(-1)?.reasonCode ?? "NO_RESULT",
          }));
          continue;
        }
        modelInvocations += 1;
        const checked = validateArtefactOutput(record.resultText, {
          canonicalPath: entry.canonicalPath!, artefactKind: entry.artefactKind,
        });
        if (!checked.accepted) {
          modelOutcomes.push(Object.freeze({
            artefact: entry.artefact, outcome: "output-refused",
            code: checked.code, detail: checked.detail, transport: record.transport ?? null,
          }));
          continue;
        }
        await storeSemanticResult(repositoryRoot, identity, checked.content,
          typeof evidence.evidenceDigest === "string" ? evidence.evidenceDigest : null);
        postimages.push(Object.freeze({ path: entry.canonicalPath!, content: checked.content }));
        realized.push(Object.freeze({
          artefact: entry.artefact, path: entry.canonicalPath!, mechanism: entry.mechanism,
          cache: "produced", digest: checked.contentDigest,
        }));
        modelOutcomes.push(Object.freeze({
          artefact: entry.artefact, outcome: "accepted",
          transport: record.transport ?? null, actualModel: record.actualModel ?? null,
          usage: record.usage ?? null,
        }));
      }
    }
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
      // A null preimage asserts absence. An artefact being re-derived because it
      // drifted from its authority is present, so its actual digest must be
      // carried or the transaction is correctly refused as stale and the drift
      // becomes undetectable-and-unfixable rather than merely undetected.
      operations: Object.freeze(await Promise.all(postimages.map(async (entry) => Object.freeze({
        kind: "write-file" as const, path: entry.path, content: entry.content,
        preimageDigest: await readFile(resolve(repositoryRoot, entry.path), "utf8")
          .then((bytes) => canonicalDigest(bytes)).catch(() => null),
      })))),
    });
    const directory = resolve(repositoryRoot, ".usf", "proposals");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    proposalPath = ".usf/proposals/delivery-realisation.json";
    await writeFile(resolve(repositoryRoot, proposalPath), `${JSON.stringify(proposal, null, 2)}\n`, { mode: 0o600 });
  }

  if (validationOutcomes.length > 0) {
    const directory = resolve(repositoryRoot, ".usf", "validation-evidence");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const record = Object.freeze({
      schema: "urn:usf:validation-evidence:1" as const,
      version: 1 as const,
      outcomeCount: validationOutcomes.length,
      outcomes: Object.freeze(validationOutcomes),
      nonClaims: Object.freeze([
        "Each outcome records that a named validator ran over an artefact digest under a recorded authority snapshot, and what it returned. It records no satisfaction.",
        "Facet satisfaction is derived from these outcomes by the evaluator; a requirement is never its own evidence.",
      ]),
    });
    await writeFile(resolve(directory, `${canonicalDigest(record).slice("sha256:".length)}.json`),
      `${JSON.stringify(record, null, 1)}\n`, { mode: 0o600 });
  }

  return {
    output: Object.freeze({
      ...plan,
      validationOutcomes: Object.freeze(validationOutcomes),
      proposalPath,
      batchSize: postimages.length,
      realizedCount: realized.length,
      modelDispatch: Object.freeze({
        candidateCount: semantic.filter((e) => e.mechanism === "SEMANTIC_MODEL_WORK").length,
        cacheHits, modelInvocations,
        outcomes: Object.freeze(modelOutcomes),
        dispatched: envFile !== undefined,
      }),
      realized: Object.freeze(realized),
      // The caller batches these into one transaction; realise computes, it does
      // not mutate, so a failed batch leaves nothing partially written.
      proposedPostimages: Object.freeze(postimages.map((entry) => Object.freeze({
        path: entry.path, contentDigest: canonicalDigest(entry.content),
      }))),
      facets,
      cache: await semanticCacheStatistics(repositoryRoot),
    }),
    exitCode: exitCodes.SUCCESS,
  };
}
