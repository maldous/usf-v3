import type { Quad } from "./nquads.ts";

/**
 * Whole-corpus semantic integrity invariants. A conforming corpus yields zero
 * violations.
 *
 * This suite is the V3 compression of the invariants V1 and V2 protected with
 * substantially more machinery. V2 expressed 98 integrity branches in one 994
 * line SPARQL query over a Stardog control plane, and enforced conventions
 * through a materialisation contract, an authority digest, signing and a
 * publication chain. The invariants below are what those mechanisms were
 * actually protecting; the mechanisms themselves are not reproduced.
 */
export type IntegrityCode =
  | "undeclared-type"
  | "dangling-reference"
  | "multiple-type-declaration"
  | "self-dependency"
  | "type-local-name-style"
  | "predicate-local-name-style"
  | "instance-local-name-style"
  | "iri-segment-shape"
  | "derived-type-authored"
  | "superseded-still-referenced-as-current"
  | "state-missing-reason"
  | "duplicate-quad";

export interface IntegrityViolation {
  readonly code: IntegrityCode;
  readonly subject: string;
  readonly detail: string;
  readonly graph: string;
}

export interface IntegrityReport {
  readonly schema: "urn:usf:integrity-report:1";
  readonly version: 1;
  /** Explicit so an empty violation list is never ambiguous with "not evaluated". */
  readonly evaluated: true;
  readonly quadCount: number;
  readonly subjectCount: number;
  readonly checkedCodes: readonly IntegrityCode[];
  readonly violations: readonly IntegrityViolation[];
  readonly conforming: boolean;
  readonly exemptGraphs: readonly string[];
  readonly nonClaims: readonly string[];
}

const typePredicate = "urn:usf:predicate:type";
const supersedesPredicate = "urn:usf:predicate:supersedes";
const dependencyPredicates = Object.freeze([
  "urn:usf:predicate:dependsOn",
  "urn:usf:predicate:requires",
  "urn:usf:predicate:derivedFrom",
]);

/**
 * Fallback used only when no graph-declared scope is supplied. Graph authority
 * is the source; this exists so the suite is still safe on a corpus that has
 * not yet declared its scope.
 */
export const derivedOnlyTypes: readonly string[] = Object.freeze([
  "urn:usf:type:ExecutionResult",
  "urn:usf:type:CatalogueClassification",
  "urn:usf:type:ReadinessProjection",
]);

/** States whose assertion requires an accompanying reason literal. */
const stateRequiringReason: Readonly<Record<string, string>> = Object.freeze({
  "urn:usf:predicate:activationState": "urn:usf:predicate:activationStateReason",
});

const pascalCase = /^[A-Z][A-Za-z0-9]*$/u;
const camelCase = /^[a-z][A-Za-z0-9]*$/u;
const kebabCase = /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/u;

/**
 * Kinds whose IRIs name a value produced at runtime -- an output record schema,
 * a contribution identity, a graph -- and are intentionally never defined as a
 * graph subject. Treating these as dangling would demand that the corpus
 * enumerate its own runtime outputs.
 */
export const terminalIdentifierKinds: readonly string[] = Object.freeze([
  "bootstrap-carrier-adoption-receipt", "checked-candidate-receipt", "cli-error",
  "contribution", "graph", "integration-observation", "provider-census-result",
  "route-result", "semantic-qualification-result",
]);

export interface IntegrityOptions {
  /**
   * Graphs whose historical IRIs predate the canonical convention. Their names
   * are exempt from local-name style checks so history is not rewritten;
   * every structural invariant still applies to them.
   */
  readonly conventionExemptGraphs?: readonly string[];
  /**
   * Graphs that opted into the state-reason convention. It is not applied
   * retroactively: correcting legacy graphs would mutate resources owned by
   * completed work and change their digests.
   */
  readonly stateReasonGraphs?: readonly string[];
  /** Derived-only types, declared by graph authority rather than by code. */
  readonly derivedOnlyTypes?: readonly string[];
}

export function checkIntegrity(quads: readonly Quad[], options: IntegrityOptions = {}): IntegrityReport {
  const exempt = new Set(options.conventionExemptGraphs ?? []);
  const stateReasonScope = new Set(options.stateReasonGraphs ?? []);
  const terminalKinds = new Set(terminalIdentifierKinds);
  const derivedOnly = new Set(options.derivedOnlyTypes ?? derivedOnlyTypes);
  const violations: IntegrityViolation[] = [];
  const add = (code: IntegrityCode, subject: string, detail: string, graph: string): void => {
    violations.push(Object.freeze({ code, subject, detail, graph }));
  };

  // Index once; every check reads the same snapshot so no check can disagree
  // with another about what the corpus contains.
  const definedSubjects = new Set(quads.map((quad) => quad.subject));
  const declaredTypes = new Set(quads
    .filter((quad) => quad.predicate === typePredicate && quad.objectKind === "iri")
    .map((quad) => quad.object));
  const typeDeclarationGraphs = new Map<string, Set<string>>();
  for (const quad of quads) {
    if (quad.predicate !== typePredicate) continue;
    const set = typeDeclarationGraphs.get(quad.subject) ?? new Set<string>();
    set.add(quad.graph);
    typeDeclarationGraphs.set(quad.subject, set);
  }
  const superseded = new Set(quads
    .filter((quad) => quad.predicate === supersedesPredicate && quad.objectKind === "iri")
    .map((quad) => quad.object));

  // 1. A type must itself be declared somewhere as a subject, so no instance
  //    claims membership of a class the corpus never defines.
  for (const type of declaredTypes) {
    if (!definedSubjects.has(type) && type.startsWith("urn:usf:type:")) {
      add("undeclared-type", type, "asserted as a type but never defined as a subject", "");
    }
  }

  // 2. No dangling reference: an IRI used as an object must be defined, except
  //    graph names and vocabulary namespaces that are intentionally terminal.
  for (const quad of quads) {
    if (quad.objectKind !== "iri") continue;
    if (!quad.object.startsWith("urn:usf:")) continue;
    if (quad.predicate === typePredicate) continue;
    if (terminalKinds.has(quad.object.split(":")[2] ?? "")) continue;
    if (definedSubjects.has(quad.object)) continue;
    add("dangling-reference", quad.object, `referenced by ${quad.subject} via ${quad.predicate} but never defined`, quad.graph);
  }

  // 3. A subject declares its type in exactly one graph, so ownership of a
  //    resource is unambiguous.
  for (const [subject, graphs] of typeDeclarationGraphs) {
    if (graphs.size > 1) {
      add("multiple-type-declaration", subject, `typed in ${graphs.size} graphs: ${[...graphs].sort().join(", ")}`, [...graphs].sort()[0]!);
    }
  }

  // 4. Nothing depends on itself.
  for (const quad of quads) {
    if (dependencyPredicates.includes(quad.predicate) && quad.object === quad.subject) {
      add("self-dependency", quad.subject, `depends on itself via ${quad.predicate}`, quad.graph);
    }
  }

  // 5-7. Canonical local-name style per IRI class. This is the invariant V2
  //      protected with `hyphenatedidentifier`; V3 keeps one deterministic form
  //      per class rather than one form for the whole corpus.
  const seenIri = new Set<string>();
  for (const quad of quads) {
    for (const iri of [quad.subject, quad.predicate, quad.objectKind === "iri" ? quad.object : ""]) {
      if (iri.length === 0 || !iri.startsWith("urn:usf:") || seenIri.has(iri)) continue;
      seenIri.add(iri);
      if (exempt.has(quad.graph)) continue;
      const segments = iri.split(":");
      if (segments.length < 4) continue;
      const kind = segments[2]!;
      const local = segments[3]!;
      if (kind === "type") {
        if (!pascalCase.test(local)) add("type-local-name-style", iri, "a type local name must be PascalCase", quad.graph);
      } else if (kind === "predicate") {
        if (!camelCase.test(local)) add("predicate-local-name-style", iri, "a predicate local name must be camelCase", quad.graph);
      } else if (kind === "graph") {
        continue;
      } else if (!kebabCase.test(local)) {
        add("instance-local-name-style", iri, `an instance local name must be kebab-case in class '${kind}'`, quad.graph);
      }
      // 8. Instance IRIs carry one kind segment then a name, optionally a
      //    version. A generation or era prefix is not a kind.
      if (!["type", "predicate", "graph"].includes(kind) && segments.length > 5) {
        add("iri-segment-shape", iri, "an instance IRI is urn:usf:<kind>:<name>[:<version>]; extra segments hide the kind", quad.graph);
      }
    }
  }

  // 9. Anti-self-warrant: a derived-only type must not be authored. V2 learned
  //    this as `directauthoredreadiness` and enforced it by requiring derived
  //    graphs; V3 keeps the prohibition on the type itself.
  for (const quad of quads) {
    if (quad.predicate !== typePredicate || quad.objectKind !== "iri") continue;
    if (!derivedOnly.has(quad.object)) continue;
    if (quad.graph.includes(":derived") || quad.graph.includes("-state") || quad.graph.endsWith(":results")) continue;
    add("derived-type-authored", quad.subject, `${quad.object} is derived-only and may not be authored in ${quad.graph}`, quad.graph);
  }

  // 10. A superseded resource must not also be asserted as current. V2 learned
  //     this as `replaced*stillcurrent` / `historicalproofstillcurrent`.
  for (const quad of quads) {
    if (quad.objectKind !== "iri" || !superseded.has(quad.object)) continue;
    if (quad.predicate === supersedesPredicate) continue;
    if (quad.predicate.endsWith("Historical") || quad.predicate.endsWith("supersededBy")) continue;
    if (quad.predicate === "urn:usf:predicate:activeAuthority" || quad.predicate === "urn:usf:predicate:current") {
      add("superseded-still-referenced-as-current", quad.object, `superseded but referenced as current by ${quad.subject}`, quad.graph);
    }
  }

  // 11. A state that carries consequence states its basis. Absence is never
  //     permission: this is V2's C1 generalized off the validation axis.
  for (const quad of quads) {
    const reasonPredicate = stateRequiringReason[quad.predicate];
    if (reasonPredicate === undefined) continue;
    if (!stateReasonScope.has(quad.graph)) continue;
    const hasReason = quads.some((other) => other.subject === quad.subject && other.predicate === reasonPredicate);
    if (!hasReason) {
      add("state-missing-reason", quad.subject, `${quad.predicate} requires an accompanying ${reasonPredicate}`, quad.graph);
    }
  }

  // 12. A corpus states each fact once.
  const canonicalSeen = new Map<string, number>();
  for (const quad of quads) canonicalSeen.set(quad.canonical, (canonicalSeen.get(quad.canonical) ?? 0) + 1);
  for (const [canonical, count] of canonicalSeen) {
    if (count > 1) add("duplicate-quad", canonical.split(" ")[0]!.replace(/[<>]/gu, ""), `asserted ${count} times`, "");
  }

  const checkedCodes: readonly IntegrityCode[] = Object.freeze([
    "undeclared-type", "dangling-reference", "multiple-type-declaration", "self-dependency",
    "type-local-name-style", "predicate-local-name-style", "instance-local-name-style",
    "iri-segment-shape", "derived-type-authored", "superseded-still-referenced-as-current",
    "state-missing-reason", "duplicate-quad",
  ]);

  return Object.freeze({
    schema: "urn:usf:integrity-report:1" as const,
    version: 1 as const,
    evaluated: true as const,
    quadCount: quads.length,
    subjectCount: definedSubjects.size,
    checkedCodes,
    violations: Object.freeze([...violations].sort((left, right) =>
      left.code.localeCompare(right.code) || left.subject.localeCompare(right.subject))),
    conforming: violations.length === 0,
    exemptGraphs: Object.freeze([...exempt].sort()),
    nonClaims: Object.freeze([
      "A conforming report means these enumerated invariants hold over the supplied quads. It is not a claim that the corpus is semantically complete or that unlisted invariants hold.",
      "Convention-exempt graphs are exempt from local-name style only. Every structural invariant is applied to them.",
    ]),
  });
}
