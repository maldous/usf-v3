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
  | "duplicate-quad"
  | "functional-predicate-conflict"
  | "undeclared-predicate"
  | "untyped-subject"
  | "disconnected-graph";

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
  readonly predicateCount: number;
  readonly componentCount: number;
  readonly checkedCodes: readonly IntegrityCode[];
  readonly violations: readonly IntegrityViolation[];
  readonly conforming: boolean;
  readonly exemptGraphs: readonly string[];
  readonly nonClaims: readonly string[];
}

const typePredicate = "urn:usf:predicate:type";
const supersedesPredicate = "urn:usf:predicate:supersedes";
const semanticPredicateType = "urn:usf:type:SemanticPredicate";
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

/**
 * Predicates that state exactly one value for a subject. Two values is not extra
 * information; it is a contradiction, and a reader that resolves it by taking
 * the first or by defaulting will silently do the wrong thing.
 *
 * Fallback used only when no graph-declared set is supplied. Graph authority is
 * the source; this exists so the suite is still safe on a corpus that has not
 * yet declared its functional predicates. Note that the declared set is
 * deliberately narrower than this one: a predicate whose several values are the
 * intended state, such as a transport's `selectedModel`, is excluded there.
 */
export const functionalPredicates: readonly string[] = Object.freeze([
  "urn:usf:predicate:realizationMechanism",
  "urn:usf:predicate:canonicalPath",
  "urn:usf:predicate:artefactKind",
  "urn:usf:predicate:realisationRoot",
  "urn:usf:predicate:selectedModel",
  "urn:usf:predicate:pathPattern",
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
  /**
   * Functional predicates, declared by graph authority rather than by code. A
   * predicate is absent from the declared set when several values are its
   * intended state, so constraining it would contradict authority rather than
   * catch an error.
   */
  readonly functionalPredicates?: readonly string[];
}

export function checkIntegrity(quads: readonly Quad[], options: IntegrityOptions = {}): IntegrityReport {
  const exempt = new Set(options.conventionExemptGraphs ?? []);
  const stateReasonScope = new Set(options.stateReasonGraphs ?? []);
  const terminalKinds = new Set(terminalIdentifierKinds);
  const derivedOnly = new Set(options.derivedOnlyTypes ?? derivedOnlyTypes);
  const functional = new Set(options.functionalPredicates ?? functionalPredicates);
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

  // 12. A functional predicate carries exactly one value per subject.
  const functionalSeen = new Map<string, Set<string>>();
  for (const quad of quads) {
    if (!functional.has(quad.predicate)) continue;
    const key = `${quad.subject}\u0000${quad.predicate}`;
    const values = functionalSeen.get(key) ?? new Set<string>();
    values.add(quad.object);
    functionalSeen.set(key, values);
  }
  for (const [key, values] of functionalSeen) {
    if (values.size <= 1) continue;
    const [subject, predicate] = key.split("\u0000");
    add("functional-predicate-conflict", subject!,
      `${predicate} states ${values.size} conflicting values: ${[...values].sort().join(" | ").slice(0, 160)}`, "");
  }

  // 13. A corpus states each fact once.
  const canonicalSeen = new Map<string, number>();
  for (const quad of quads) canonicalSeen.set(quad.canonical, (canonicalSeen.get(quad.canonical) ?? 0) + 1);
  for (const [canonical, count] of canonicalSeen) {
    if (count > 1) add("duplicate-quad", canonical.split(" ")[0]!.replace(/[<>]/gu, ""), `asserted ${count} times`, "");
  }

  // 14. A predicate the corpus uses is a predicate the corpus defines. V1 and V2
  //      both accumulated vocabulary faster than they declared it; 126 predicates
  //      were in use here without a declaration when this check was written.
  const declaredPredicates = new Set(quads
    .filter((quad) => quad.predicate === typePredicate && quad.object === semanticPredicateType)
    .map((quad) => quad.subject));
  const reportedPredicate = new Set<string>();
  for (const quad of quads) {
    if (!quad.predicate.startsWith("urn:usf:predicate:")) continue;
    if (declaredPredicates.has(quad.predicate) || reportedPredicate.has(quad.predicate)) continue;
    reportedPredicate.add(quad.predicate);
    add("undeclared-predicate", quad.predicate, "used as a predicate but never declared as a SemanticPredicate", quad.graph);
  }

  // 15. Every subject states what it is. An untyped subject cannot be validated
  //     against a required field set, so it is unreachable by every later rule.
  const typedSubjects = new Set(quads.filter((quad) => quad.predicate === typePredicate).map((quad) => quad.subject));
  for (const subject of definedSubjects) {
    if (typedSubjects.has(subject)) continue;
    add("untyped-subject", subject, "defined as a subject but never states a type", "");
  }

  // 16. The corpus is one graph, not several. A separate component is a set of
  //     resources nothing in the corpus can reach: documentation that looks like
  //     authority. Four such subjects existed when this check was written.
  const adjacency = new Map<string, Set<string>>();
  const link = (from: string, to: string): void => {
    const set = adjacency.get(from) ?? new Set<string>();
    set.add(to);
    adjacency.set(from, set);
  };
  const componentNodes = new Set<string>();
  for (const quad of quads) {
    componentNodes.add(quad.subject);
    if (quad.objectKind !== "iri" || !definedSubjects.has(quad.object)) continue;
    componentNodes.add(quad.object);
    link(quad.subject, quad.object);
    link(quad.object, quad.subject);
  }
  const visited = new Set<string>();
  const components: string[][] = [];
  for (const node of componentNodes) {
    if (visited.has(node)) continue;
    const component: string[] = [];
    const pending = [node];
    visited.add(node);
    while (pending.length > 0) {
      const current = pending.pop()!;
      component.push(current);
      for (const next of adjacency.get(current) ?? []) {
        if (visited.has(next)) continue;
        visited.add(next);
        pending.push(next);
      }
    }
    components.push(component);
  }
  if (components.length > 1) {
    // Largest first, then by smallest member IRI. Size alone is not a total
    // order, and two components of equal size must not swap between runs.
    const labelled = components.map((component) => Object.freeze({ component, first: [...component].sort()[0]! }));
    const sorted = [...labelled].sort((left, right) =>
      right.component.length - left.component.length || left.first.localeCompare(right.first));
    for (const entry of sorted.slice(1)) {
      add("disconnected-graph", entry.first,
        `in a component of ${entry.component.length} unreachable from the main component of ${sorted[0]!.component.length}`, "");
    }
  }

  const checkedCodes: readonly IntegrityCode[] = Object.freeze([
    "undeclared-type", "dangling-reference", "multiple-type-declaration", "self-dependency",
    "type-local-name-style", "predicate-local-name-style", "instance-local-name-style",
    "iri-segment-shape", "derived-type-authored", "superseded-still-referenced-as-current",
    "state-missing-reason", "duplicate-quad", "functional-predicate-conflict",
    "undeclared-predicate", "untyped-subject", "disconnected-graph",
  ]);

  return Object.freeze({
    schema: "urn:usf:integrity-report:1" as const,
    version: 1 as const,
    evaluated: true as const,
    quadCount: quads.length,
    subjectCount: definedSubjects.size,
    predicateCount: new Set(quads.map((quad) => quad.predicate)).size,
    componentCount: components.length,
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
