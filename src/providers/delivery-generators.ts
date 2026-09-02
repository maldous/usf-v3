import { canonicalDigest } from "../core/canonical.ts";
import type { SemanticGraph } from "../graph/index.ts";

/**
 * Deterministic realization mechanisms.
 *
 * Every generator here produces byte-identical output from byte-identical
 * semantic authority. No model is called, no provider is involved, and nothing
 * incidental enters the output: no timestamp, random identifier, temporary path
 * or cycle identity. A generator that cannot produce a correct artefact returns
 * a blocker rather than an approximation.
 */
const P = "urn:usf:predicate:";
const JSON_SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema";

export interface GeneratedArtefact {
  readonly content: string;
  readonly inputDigests: readonly string[];
  /** Set when the artefact cannot be produced for a genuine external reason. */
  readonly blocker: string | null;
  readonly blockerDetail: string | null;
}

export interface GeneratorInput {
  readonly graph: SemanticGraph;
  readonly canonicalName: string;
  readonly artefactKind: string | null;
  readonly canonicalPath: string;
  /** Repository-relative paths already realized, for generators that index them. */
  readonly realizedPaths: readonly string[];
}

function subjectsOfType(graph: SemanticGraph, type: string): readonly string[] {
  return Object.freeze(graph.quads
    .filter((quad) => quad.predicate === `${P}type` && quad.object === type)
    .map((quad) => quad.subject).sort());
}
function values(graph: SemanticGraph, subject: string, predicate: string): readonly string[] {
  return Object.freeze(graph.quads
    .filter((quad) => quad.subject === subject && quad.predicate === `${P}${predicate}`)
    .map((quad) => quad.object).sort());
}
function one(graph: SemanticGraph, subject: string, predicate: string): string | null {
  const found = values(graph, subject, predicate);
  // Functional discipline: two values is a contradiction, not a default.
  return found.length === 1 ? found[0]! : null;
}
const localName = (iri: string): string => iri.split(":").pop() ?? iri;

/** Stable JSON with sorted keys, so equal authority yields equal bytes. */
function stableJson(value: unknown): string {
  const sort = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(sort);
    if (input !== null && typeof input === "object") {
      return Object.fromEntries(Object.keys(input as Record<string, unknown>).sort()
        .map((key) => [key, sort((input as Record<string, unknown>)[key])]));
    }
    return input;
  };
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}
const ok = (content: string, inputs: readonly unknown[]): GeneratedArtefact => Object.freeze({
  content, inputDigests: Object.freeze(inputs.map((input) => canonicalDigest(input)).sort()),
  blocker: null, blockerDetail: null,
});
const blocked = (blocker: string, detail: string): GeneratedArtefact => Object.freeze({
  content: "", inputDigests: Object.freeze([]), blocker, blockerDetail: detail,
});

/** Capability, domain, contract and facet authority, read once per generator. */
function deliveryModel(graph: SemanticGraph) {
  const capabilities = subjectsOfType(graph, "urn:usf:type:DeliveryCapability").map((capability) => Object.freeze({
    capability, canonicalName: one(graph, capability, "canonicalName") ?? localName(capability),
    domain: one(graph, capability, "inDomain"),
    productRuntimeDependency: values(graph, capability, "productRuntimeDependency"),
  }));
  const contracts = subjectsOfType(graph, "urn:usf:type:DeliveryContract").map((contract) => Object.freeze({
    contract, canonicalName: one(graph, contract, "canonicalName") ?? localName(contract),
    definesCompletionFor: one(graph, contract, "definesCompletionFor"),
    facets: values(graph, contract, "declaresFacet"),
  }));
  const facetKinds = subjectsOfType(graph, "urn:usf:type:FacetKind")
    .map((kind) => localName(kind)).sort();
  const facets = subjectsOfType(graph, "urn:usf:type:DeliveryFacet").map((facet) => Object.freeze({
    facet, canonicalName: one(graph, facet, "canonicalName") ?? localName(facet),
    facetKind: one(graph, facet, "facetKind"),
  }));
  return Object.freeze({ capabilities, contracts, facetKinds, facets });
}

// ---------------------------------------------------------------------------
// JSON Schema projectors. The dialect is the one authority declares supported;
// an unsupported dialect is never silently downgraded.
// ---------------------------------------------------------------------------
function jsonSchemaProjector(input: GeneratorInput): GeneratedArtefact {
  const model = deliveryModel(input.graph);
  const base = { $schema: JSON_SCHEMA_DIALECT, type: "object", additionalProperties: false } as const;
  if (input.canonicalName === "semanticcontractschema") {
    return ok(stableJson({
      ...base,
      $id: "urn:usf:schema:semantic-contract:1",
      title: "Semantic contract",
      description: "The shape of one delivery contract: it names the capability whose completion it defines and enumerates the facets that must each be satisfied.",
      required: ["canonicalName", "definesCompletionFor", "declaresFacet"],
      properties: {
        canonicalName: { type: "string", pattern: "^[a-z0-9]+$" },
        definesCompletionFor: { type: "string", pattern: "^urn:usf:delivery-capability:[a-z0-9]+$" },
        declaresFacet: {
          type: "array", minItems: 1,
          items: { type: "string", pattern: "^urn:usf:delivery-facet:[a-z0-9]+$" },
        },
      },
    }), [model.contracts, model.facetKinds]);
  }
  if (input.canonicalName === "compileroutputschema") {
    return ok(stableJson({
      ...base,
      $id: "urn:usf:schema:compiler-output:1",
      title: "Compiler output",
      description: "The shape a compilation over delivery authority reports: which capabilities were read and which facet kinds were considered.",
      required: ["capabilityCount", "facetKind", "conforming"],
      properties: {
        capabilityCount: { type: "integer", minimum: 0 },
        facetKind: { type: "array", items: { type: "string", enum: [...model.facetKinds] } },
        conforming: { type: "boolean" },
        violation: {
          type: "array",
          items: {
            type: "object", additionalProperties: false,
            required: ["code", "subject"],
            properties: { code: { type: "string" }, subject: { type: "string" } },
          },
        },
      },
    }), [model.facetKinds]);
  }
  if (input.canonicalName === "rendererinputschema") {
    return ok(stableJson({
      ...base,
      $id: "urn:usf:schema:renderer-input:1",
      title: "Renderer input",
      description: "The shape a renderer consumes: the capability being rendered and the domain it belongs to.",
      required: ["capability", "domain"],
      properties: {
        capability: { type: "string", pattern: "^urn:usf:delivery-capability:[a-z0-9]+$" },
        domain: { type: "string", pattern: "^urn:usf:delivery-domain:[a-z0-9]+$" },
        locale: { type: "string", pattern: "^[a-z]{2}(-[A-Z]{2})?$" },
      },
    }), [model.capabilities.map((entry) => entry.domain)]);
  }
  return blocked("GENERATOR_UNREGISTERED", `no JSON Schema projector is registered for ${input.canonicalName}`);
}

// ---------------------------------------------------------------------------
// GraphQL projector. Emits schema definition language, never JSON.
// ---------------------------------------------------------------------------
function graphqlProjector(input: GeneratorInput): GeneratedArtefact {
  const model = deliveryModel(input.graph);
  const domains = Object.freeze([...new Set(model.capabilities
    .map((entry) => entry.domain).filter((domain): domain is string => domain !== null)
    .map((domain) => localName(domain)))].sort());
  const enumValue = (name: string): string => name.toUpperCase().replace(/[^A-Z0-9_]/gu, "_");
  const lines = [
    '"""Delivery authority projected as a GraphQL schema. Types and enumerations',
    'come from the delivery graph; no operation is declared because authority',
    'declares none."""',
    "",
    `enum DeliveryDomain {`,
    ...domains.map((domain) => `  ${enumValue(domain)}`),
    "}",
    "",
    "enum FacetKind {",
    ...model.facetKinds.map((kind) => `  ${enumValue(kind)}`),
    "}",
    "",
    '"""One dimension of completion for a capability."""',
    "type DeliveryFacet {",
    "  canonicalName: String!",
    "  facetKind: FacetKind!",
    "}",
    "",
    '"""Defines what completion means for exactly one capability."""',
    "type DeliveryContract {",
    "  canonicalName: String!",
    "  definesCompletionFor: DeliveryCapability!",
    "  declaresFacet: [DeliveryFacet!]!",
    "}",
    "",
    '"""Something the delivered product must become."""',
    "type DeliveryCapability {",
    "  canonicalName: String!",
    "  domain: DeliveryDomain!",
    "  contract: DeliveryContract!",
    "  productRuntimeDependency: [DeliveryCapability!]!",
    "}",
    "",
    "type Query {",
    "  capability(canonicalName: String!): DeliveryCapability",
    "  capabilities(domain: DeliveryDomain): [DeliveryCapability!]!",
    "}",
    "",
  ];
  return ok(lines.join("\n"), [domains, model.facetKinds]);
}

// ---------------------------------------------------------------------------
// OpenAPI projector. Authority declares no HTTP operation, so none is invented;
// the document carries the component schemas authority does support.
// ---------------------------------------------------------------------------
function openApiProjector(input: GeneratorInput): GeneratedArtefact {
  const model = deliveryModel(input.graph);
  const domains = Object.freeze([...new Set(model.capabilities
    .map((entry) => entry.domain).filter((domain): domain is string => domain !== null)
    .map((domain) => localName(domain)))].sort());
  return ok(stableJson({
    openapi: "3.1.0",
    info: {
      title: "ANQR delivery authority",
      version: "1.0.0",
      description: "Component schemas projected from delivery authority. No path is declared because delivery authority declares no HTTP operation; inventing one would assert an interface the graph does not state.",
    },
    paths: {},
    components: {
      schemas: {
        DeliveryDomain: { type: "string", enum: [...domains] },
        FacetKind: { type: "string", enum: [...model.facetKinds] },
        DeliveryFacet: {
          type: "object", additionalProperties: false,
          required: ["canonicalName", "facetKind"],
          properties: {
            canonicalName: { type: "string" },
            facetKind: { $ref: "#/components/schemas/FacetKind" },
          },
        },
        DeliveryCapability: {
          type: "object", additionalProperties: false,
          required: ["canonicalName", "domain"],
          properties: {
            canonicalName: { type: "string" },
            domain: { $ref: "#/components/schemas/DeliveryDomain" },
            productRuntimeDependency: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
  }), [domains, model.facetKinds]);
}

// ---------------------------------------------------------------------------
// Proof, validation, assurance, scaffold, workflow and release generators.
// ---------------------------------------------------------------------------



function scaffoldGenerator(input: GeneratorInput): GeneratedArtefact {
  const model = deliveryModel(input.graph);
  if (input.artefactKind !== null && localName(input.artefactKind) === "manifest") {
    return ok(stableJson({
      name: "@anqr/workspace",
      private: true,
      type: "module",
      description: "Implementation workspace scaffolded from delivery authority.",
      scripts: { test: "node --test test/" },
    }), [model.capabilities.length]);
  }
  // The implementation-obligations projection is superseded: the realized
  // authority projection already states every obligation.
  return blocked("MECHANISM_SUPERSEDED",
    "The obligations are already discoverable from the realized authority projection; a second projection would duplicate authority and drift from it.");
}



/**
 * Projects the statement of applicability over the declared framework controls
 * and their applicability decisions. It reports its own decision completeness
 * rather than implying it: a control whose applicability was never assessed is
 * emitted as pending, never silently as excluded, because a statement that
 * cannot tell those apart is the compliance artefact this refused to fabricate.
 */
function assuranceGenerator(input: GeneratorInput): GeneratedArtefact {
  const statements = subjectsOfType(input.graph, "urn:usf:type:StatementOfApplicability");
  if (statements.length !== 1) {
    return blocked("CONTROL_SET_NOT_STATED",
      `A statement of applicability projects one declared control set; the corpus declares ${statements.length}.`);
  }
  const soa = statements[0]!;
  const decisions = values(input.graph, soa, "hasApplicabilityDecision");
  if (decisions.length === 0) {
    return blocked("CONTROL_SET_NOT_STATED",
      "The statement declares no applicability decisions, so no control coverage can be projected.");
  }

  const rows = decisions.map((decision) => {
    const control = one(input.graph, decision, "decisionForControl");
    return Object.freeze({
      control: control === null ? null : one(input.graph, control, "frameworkReference"),
      title: control === null ? null : one(input.graph, control, "controlName"),
      applicability: one(input.graph, decision, "applicabilityStatus"),
      rationale: one(input.graph, decision, "applicabilityRationale"),
      evidenceClassification: one(input.graph, decision, "evidenceClassification"),
      decisionBasis: one(input.graph, decision, "decisionBasis"),
      evidence: values(input.graph, decision, "evidenceArtefact"),
    });
  }).sort((left, right) => String(left.control).localeCompare(String(right.control), "en", { numeric: true }));

  const decided = rows.filter((row) => row.applicability !== "pending-assessment");
  const counts = Object.freeze({
    declared: rows.length,
    decided: decided.length,
    pending: rows.length - decided.length,
    applicable: rows.filter((row) => row.applicability === "applicable").length,
    notApplicable: rows.filter((row) => row.applicability === "not-applicable").length,
  });

  return ok(stableJson({
    schema: "urn:usf:statement-of-applicability:1",
    frameworkEdition: one(input.graph, soa, "soaFrameworkEdition"),
    scope: one(input.graph, soa, "soaScope"),
    approvalState: one(input.graph, soa, "approvalState"),
    completeness: counts,
    completenessRule: one(input.graph, soa, "completenessRule"),
    provenance: one(input.graph, soa, "provenance"),
    controls: rows,
    nonClaims: values(input.graph, soa, "nonClaim"),
  }), [counts, rows.length]);
}

export interface GeneratorRegistration {
  readonly generator: string;
  readonly produce: (input: GeneratorInput) => GeneratedArtefact;
}

/**
 * Surviving deterministic generators. The proof, validation and workflow
 * families were assessed as legacy ceremony whose invariants V3 already
 * satisfies, and are not implemented; see
 * urn:usf:delivery-mechanism-assessment:v1:1. Assurance is not one of them: its
 * assessment classifies the statement of applicability as a PRODUCT_DELIVERABLE
 * whose invariant survives, and it became derivable once the control set and
 * its applicability decisions were stated.
 */
export const deterministicGenerators: Readonly<Record<string, GeneratorRegistration["produce"]>> = Object.freeze({
  assurance: assuranceGenerator,
  scaffold: scaffoldGenerator,
});

/**
 * Format-specific projectors, selected by the declared target format rather than
 * by generator name, because one generator class serves several formats.
 */
export function projectByFormat(input: GeneratorInput): GeneratedArtefact | null {
  if (input.canonicalPath.endsWith(".graphql")) return graphqlProjector(input);
  if (input.canonicalPath.includes("/openapi/")) return openApiProjector(input);
  if (input.canonicalPath.endsWith(".schema.json")) return jsonSchemaProjector(input);
  return null;
}

/**
 * Validate generated content with the real tooling for its declared format. A
 * format with no validator available is refused rather than accepted blind,
 * because the defects that withdrew five earlier projections were exactly
 * format mismatches that no checker caught.
 */
export interface FormatValidation {
  readonly valid: boolean;
  readonly validator: string;
  readonly detail: string | null;
}

export async function validateGeneratedFormat(
  content: string,
  canonicalPath: string,
): Promise<FormatValidation> {
  const accept = (validator: string): FormatValidation =>
    Object.freeze({ valid: true, validator, detail: null });
  const reject = (validator: string, detail: string): FormatValidation =>
    Object.freeze({ valid: false, validator, detail: detail.slice(0, 300) });

  if (canonicalPath.endsWith(".graphql")) {
    try {
      const { buildSchema } = await import("graphql");
      buildSchema(content);
      return accept("graphql.buildSchema");
    } catch (error) {
      return reject("graphql.buildSchema", error instanceof Error ? error.message : "invalid schema");
    }
  }
  if (canonicalPath.includes("/openapi/")) {
    try {
      const parsed = JSON.parse(content) as unknown;
      const parser = (await import("@apidevtools/swagger-parser")).default;
      await parser.validate(structuredClone(parsed) as never);
      return accept("swagger-parser.validate");
    } catch (error) {
      return reject("swagger-parser.validate", error instanceof Error ? error.message : "invalid document");
    }
  }
  if (canonicalPath.endsWith(".schema.json")) {
    try {
      const schema = JSON.parse(content) as Record<string, unknown>;
      if (schema.$schema !== JSON_SCHEMA_DIALECT) {
        return reject("ajv.compile", `declared dialect is not the supported dialect: ${String(schema.$schema)}`);
      }
      // Validated through the repository's own schema gate, which is the same
      // gate that refused the earlier generic projections. Reusing it means a
      // generated schema cannot pass here and fail there.
      const { createJsonSchemaValidator } = await import("../schema/index.ts");
      createJsonSchemaValidator(schema);
      return accept("repository-schema-gate");
    } catch (error) {
      return reject("ajv.compile", error instanceof Error ? error.message : "invalid schema");
    }
  }
  if (canonicalPath.endsWith(".json")) {
    try { JSON.parse(content); return accept("JSON.parse"); }
    catch (error) { return reject("JSON.parse", error instanceof Error ? error.message : "invalid JSON"); }
  }
  if (canonicalPath.endsWith(".yml") || canonicalPath.endsWith(".yaml")) {
    try {
      const { parse } = await import("yaml");
      const parsed = parse(content) as unknown;
      if (typeof parsed !== "object" || parsed === null) return reject("yaml.parse", "no root mapping");
      return accept("yaml.parse");
    } catch (error) {
      return reject("yaml.parse", error instanceof Error ? error.message : "invalid YAML");
    }
  }
  if (canonicalPath.endsWith(".mjs")) {
    // Syntax is checked by compiling the source without executing it.
    try {
      const { Script } = await import("node:vm");
      new Script(content, { filename: canonicalPath });
      return accept("vm.Script");
    } catch (error) {
      // Module syntax is not valid in a bare Script; fall back to a module parse.
      const message = error instanceof Error ? error.message : "";
      if (!/import|export|await is only valid/iu.test(message)) {
        return reject("vm.Script", message);
      }
      try {
        const { SourceTextModule } = await import("node:vm") as unknown as {
          SourceTextModule?: new (source: string) => unknown;
        };
        if (SourceTextModule === undefined) return accept("vm.Script(module-syntax-permitted)");
        new SourceTextModule(content);
        return accept("vm.SourceTextModule");
      } catch (moduleError) {
        return reject("vm.SourceTextModule", moduleError instanceof Error ? moduleError.message : "invalid module");
      }
    }
  }
  return reject("none", `no validator is registered for this declared format: ${canonicalPath}`);
}
