import { createHash } from "node:crypto";

export interface DeclarationQuad {
  readonly subject: string;
  readonly predicate: string;
  readonly object: string;
  readonly objectKind: "iri" | "literal";
}

/**
 * Reads an architecture declaration out of semantic quads.
 *
 * Pure by construction: it touches no filesystem, spawns nothing and knows no
 * repository path. That is what lets the same reader serve the confined
 * validation, which holds a synthetic corpus, and the corpus lane, which holds
 * the real one. Everything it returns is a declaration -- what the graph says
 * the architecture is. Nothing here observes an implementation, and nothing
 * here decides conformance.
 */

const P = "urn:usf:predicate:";
const T = "urn:usf:type:";

export interface ArchitecturalLayerDeclaration {
  readonly iri: string;
  readonly canonicalName: string;
  readonly ordinal: number | null;
}

export interface ArchitecturalComponentDeclaration {
  readonly iri: string;
  readonly canonicalName: string;
  readonly layer: string | null;
  readonly locations: readonly string[];
}

export interface DependencyRuleDeclaration {
  readonly iri: string;
  readonly kind: "permits" | "forbids" | "requires";
  readonly from: string;
  readonly to: string;
  readonly reason: string | null;
}

export interface ModuleBoundaryDeclaration {
  readonly iri: string;
  readonly scopes: readonly string[];
  readonly forbids: readonly string[];
}

export interface CyclePolicyDeclaration {
  readonly iri: string;
  readonly cyclesPermitted: boolean;
  readonly permittedCycleMembers: readonly string[];
  readonly scope: string | null;
}

export interface EntryPointDeclaration {
  readonly iri: string;
  readonly module: string;
  readonly surface: string;
  readonly contributesToRuntimeReachability: boolean;
  readonly reason: string | null;
}

export interface PopulationDeclaration {
  readonly iri: string;
  readonly roots: readonly string[];
  readonly suffixes: readonly string[];
  readonly excludedRoots: readonly string[];
}

export interface ClassificationDeclaration {
  readonly iri: string;
  readonly canonicalName: string;
  readonly criterion: string;
  readonly precedence: number;
  readonly conforming: boolean;
  readonly defersArchitectureJudgement: boolean;
  readonly meaning: string | null;
}

export interface DispositionDecisionDeclaration {
  readonly iri: string;
  readonly classifiesAs: string;
  readonly roots: readonly string[];
  readonly units: readonly string[];
  readonly reason: string | null;
  readonly owner: string | null;
}

export interface RequirementDeclaration {
  readonly iri: string;
  readonly canonicalName: string;
  readonly severity: string | null;
  readonly verificationClass: string | null;
  readonly assuranceScope: string | null;
  readonly conformanceProcedure: string | null;
  readonly text: string | null;
  readonly expectedResult: string | null;
}

export interface AssuranceSetDeclaration {
  readonly iri: string;
  readonly canonicalName: string;
  readonly scope: string | null;
  readonly members: readonly string[];
}

export interface ReleaseAssuranceClaimDeclaration {
  readonly iri: string;
  readonly canonicalName: string;
  readonly dependsOn: readonly string[];
  readonly absentEvidenceDisposition: string | null;
}

export interface EnforcementBindingDeclaration {
  readonly iri: string;
  readonly enforcesRequirements: readonly string[];
  readonly modules: readonly string[];
  readonly invocation: string | null;
}

export interface AdversarialVerificationDeclaration {
  readonly iri: string;
  readonly target: string | null;
  readonly plantedViolation: string | null;
  readonly expectedDetection: string | null;
}

export interface ArchitectureDeclaration {
  readonly architecture: string | null;
  readonly layers: readonly ArchitecturalLayerDeclaration[];
  readonly components: readonly ArchitecturalComponentDeclaration[];
  readonly dependencyRules: readonly DependencyRuleDeclaration[];
  readonly moduleBoundaries: readonly ModuleBoundaryDeclaration[];
  readonly cyclePolicies: readonly CyclePolicyDeclaration[];
  readonly entryPoints: readonly EntryPointDeclaration[];
  readonly population: PopulationDeclaration | null;
  readonly classifications: readonly ClassificationDeclaration[];
  readonly dispositionDecisions: readonly DispositionDecisionDeclaration[];
  readonly requirements: readonly RequirementDeclaration[];
  readonly assuranceSets: readonly AssuranceSetDeclaration[];
  readonly releaseClaims: readonly ReleaseAssuranceClaimDeclaration[];
  readonly enforcementBindings: readonly EnforcementBindingDeclaration[];
  readonly adversarialVerifications: readonly AdversarialVerificationDeclaration[];
  /** Corpus facts an implementation classification criterion resolves against. */
  readonly workWritePaths: readonly string[];
  readonly validationClosureFiles: readonly string[];
  readonly generatedCodeLocations: readonly string[];
}

class QuadIndex {
  private readonly bySubject = new Map<string, DeclarationQuad[]>();

  constructor(quads: Iterable<DeclarationQuad>) {
    for (const quad of quads) {
      const existing = this.bySubject.get(quad.subject);
      if (existing === undefined) this.bySubject.set(quad.subject, [quad]);
      else existing.push(quad);
    }
  }

  subjectsOfType(type: string): string[] {
    const found: string[] = [];
    for (const [subject, quads] of this.bySubject) {
      if (quads.some((quad) => quad.predicate === `${P}type` && quad.object === type)) found.push(subject);
    }
    return found.sort();
  }

  values(subject: string, predicate: string): string[] {
    return (this.bySubject.get(subject) ?? []).filter((quad) => quad.predicate === `${P}${predicate}`).map((quad) => quad.object).sort();
  }

  value(subject: string, predicate: string): string | null {
    return this.values(subject, predicate)[0] ?? null;
  }

  flag(subject: string, predicate: string, fallback: boolean): boolean {
    const raw = this.value(subject, predicate);
    return raw === null ? fallback : raw === "true";
  }
}

function integerOr(raw: string | null, fallback: number): number {
  if (raw === null) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

/**
 * Builds the declaration for one architecture. Passing the architecture IRI
 * explicitly is deliberate: a corpus may hold several declared architectures --
 * a product's and the foundation's -- and reading "the" architecture out of a
 * corpus that holds two is how one silently judges the other.
 */
export function readArchitectureDeclaration(quads: Iterable<DeclarationQuad>, architecture: string): ArchitectureDeclaration {
  const index = new QuadIndex(quads);
  const layerIris = new Set(index.values(architecture, "hasLayer"));
  const componentIris = new Set(index.values(architecture, "hasComponent"));

  const layers = [...layerIris].sort().map((iri) => ({
    iri,
    canonicalName: index.value(iri, "canonicalName") ?? iri,
    ordinal: index.value(iri, "layerOrdinal") === null ? null : integerOr(index.value(iri, "layerOrdinal"), 0),
  }));

  const components = [...componentIris].sort().map((iri) => ({
    iri,
    canonicalName: index.value(iri, "canonicalName") ?? iri,
    layer: index.value(iri, "inLayer"),
    locations: index.values(iri, "componentLocation"),
  }));

  const ruleKind = (iri: string): DependencyRuleDeclaration["kind"] | null => {
    const declared = index.value(iri, "dependencyRuleKind");
    if (declared === "urn:usf:dependency-rule-kind:permits") return "permits";
    if (declared === "urn:usf:dependency-rule-kind:forbids") return "forbids";
    if (declared === "urn:usf:dependency-rule-kind:requires") return "requires";
    return null;
  };

  const dependencyRules: DependencyRuleDeclaration[] = [];
  for (const iri of index.subjectsOfType(`${T}DependencyDirectionRule`)) {
    const kind = ruleKind(iri);
    const from = index.value(iri, "dependencyFrom");
    const to = index.value(iri, "dependencyTo");
    if (kind === null || from === null || to === null) continue;
    if (!layerIris.has(from) && !componentIris.has(from)) continue;
    dependencyRules.push({ iri, kind, from, to, reason: index.value(iri, "dependencyRuleReason") });
  }

  const moduleBoundaries = index.subjectsOfType(`${T}ModuleBoundaryRule`)
    .filter((iri) => index.values(iri, "boundaryScope").includes(architecture))
    .map((iri) => ({
      iri,
      scopes: index.values(iri, "boundaryScope").filter((scope) => scope !== architecture),
      forbids: index.values(iri, "boundaryForbids"),
    }));

  const cyclePolicies = index.values(architecture, "cyclePolicy").map((iri) => ({
    iri,
    cyclesPermitted: index.flag(iri, "cyclesPermitted", false),
    permittedCycleMembers: index.values(iri, "permittedCycleMember"),
    scope: index.value(iri, "cyclePolicyScope"),
  }));

  const entryPoints: EntryPointDeclaration[] = [];
  for (const iri of index.values(architecture, "declaresEntryPoint")) {
    const module = index.value(iri, "entryPointModule");
    const surface = index.value(iri, "entryPointSurface");
    if (module === null || surface === null) continue;
    entryPoints.push({
      iri,
      module,
      surface,
      contributesToRuntimeReachability: index.flag(surface, "contributesToRuntimeReachability", false),
      reason: index.value(iri, "entryPointReason"),
    });
  }

  const populationIri = index.value(architecture, "declaresPopulation");
  const population = populationIri === null ? null : {
    iri: populationIri,
    roots: index.values(populationIri, "populationRoot"),
    suffixes: index.values(populationIri, "populationMemberSuffix"),
    excludedRoots: index.values(populationIri, "populationExcludedRoot"),
  };

  const classifications = index.values(architecture, "permittedClassification").flatMap((iri) => {
    const criterion = index.value(iri, "classificationCriterion");
    if (criterion === null) return [];
    return [{
      iri,
      canonicalName: index.value(iri, "canonicalName") ?? iri,
      criterion,
      precedence: integerOr(index.value(iri, "classificationPrecedence"), Number.MAX_SAFE_INTEGER),
      conforming: index.flag(iri, "classificationConforming", true),
      defersArchitectureJudgement: index.flag(iri, "defersArchitectureJudgement", false),
      meaning: index.value(iri, "dispositionMeaning"),
    }];
  }).sort((left, right) => left.precedence - right.precedence || left.iri.localeCompare(right.iri));

  const dispositionDecisions = index.subjectsOfType(`${T}ImplementationDispositionDecision`).flatMap((iri) => {
    const classifiesAs = index.value(iri, "classifiesAs");
    if (classifiesAs === null) return [];
    return [{
      iri,
      classifiesAs,
      roots: index.values(iri, "dispositionRoot"),
      units: index.values(iri, "dispositionUnit"),
      reason: index.value(iri, "dispositionReason"),
      owner: index.value(iri, "dispositionOwner"),
    }];
  });

  const assuranceSets = index.subjectsOfType(`${T}AssuranceSet`).map((iri) => ({
    iri,
    canonicalName: index.value(iri, "canonicalName") ?? iri,
    scope: index.value(iri, "assuranceScope"),
    members: index.values(iri, "assuranceMember"),
  }));

  const declaredRequirementIris = new Set(assuranceSets.flatMap((set) => set.members));
  const requirements = [...declaredRequirementIris].sort().map((iri) => ({
    iri,
    canonicalName: index.value(iri, "canonicalName") ?? iri,
    severity: index.value(iri, "requirementSeverity"),
    verificationClass: index.value(iri, "verificationClass"),
    assuranceScope: index.value(iri, "assuranceScope"),
    conformanceProcedure: index.value(iri, "conformanceProcedure"),
    text: index.value(iri, "text"),
    expectedResult: index.value(iri, "expectedResult"),
  }));

  const releaseClaims = index.subjectsOfType(`${T}ReleaseAssuranceClaim`).map((iri) => ({
    iri,
    canonicalName: index.value(iri, "canonicalName") ?? iri,
    dependsOn: index.values(iri, "dependsOnAssuranceSet"),
    absentEvidenceDisposition: index.value(iri, "absentEvidenceDisposition"),
  }));

  const enforcementBindings = index.subjectsOfType(`${T}EnforcementBinding`).map((iri) => ({
    iri,
    enforcesRequirements: index.values(iri, "enforcesRequirement"),
    modules: index.values(iri, "enforcementModule"),
    invocation: index.value(iri, "enforcementInvocation"),
  }));

  const adversarialVerifications = index.subjectsOfType(`${T}AdversarialVerification`).map((iri) => ({
    iri,
    target: index.value(iri, "adversarialTarget"),
    plantedViolation: index.value(iri, "plantedViolation"),
    expectedDetection: index.value(iri, "expectedDetection"),
  }));

  const workWritePaths = new Set<string>();
  for (const work of index.subjectsOfType(`${T}WorkPacket`)) for (const path of index.values(work, "writePath")) workWritePaths.add(path);
  const validationClosureFiles = new Set<string>();
  for (const closure of index.subjectsOfType(`${T}ValidationRuntimeClosure`)) {
    for (const path of index.values(closure, "repositoryReadFile")) validationClosureFiles.add(path);
  }

  const generatedCodeLocations = index.values(architecture, "generatedCodeBoundary").flatMap((iri) => index.values(iri, "generatedCodeLocation"));

  return {
    architecture,
    layers,
    components,
    dependencyRules,
    moduleBoundaries,
    cyclePolicies,
    entryPoints,
    population,
    classifications,
    dispositionDecisions,
    requirements,
    assuranceSets,
    releaseClaims,
    enforcementBindings,
    adversarialVerifications,
    workWritePaths: [...workWritePaths].sort(),
    validationClosureFiles: [...validationClosureFiles].sort(),
    generatedCodeLocations: generatedCodeLocations.sort(),
  };
}

/** A stable identity for one declaration, so evidence cannot be reused across a moved model. */
export function declarationDigest(declaration: ArchitectureDeclaration): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(declaration), "utf8").digest("hex")}`;
}
