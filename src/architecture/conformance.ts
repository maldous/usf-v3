import { declarationDigest, type ArchitectureDeclaration, type ClassificationDeclaration } from "./declaration.ts";
import type { ArchitectureObservation } from "./observe.ts";

/**
 * The evaluator. It decides conformance and observes nothing.
 *
 * Every decision it makes is taken from the declaration: which classifications
 * exist, in what precedence, by what criterion, which requirements are declared,
 * at what scope and severity, and which requirement belongs to which assurance
 * set. The evaluator supplies only the mechanics of deciding, which is why
 * replacing the observer leaves conformance unchanged and why widening the
 * model is a graph edit rather than a code edit.
 *
 * It fails closed in three separate ways, and the difference between them is
 * the point of the whole model: a requirement whose rule this evaluator cannot
 * decide is missing evidence, not success; a requirement whose scope the
 * observation cannot cover is unsatisfied scope, not success and not failure;
 * and an observation taken against a different model or a different tree is
 * stale, not evidence.
 */

export const conformanceDispositions = Object.freeze({
  conforming: "CONFORMING",
  failed: "ARCHITECTURE_CONFORMANCE_FAILED",
  evidenceMissing: "ASSURANCE_EVIDENCE_MISSING",
  evidenceStale: "ASSURANCE_EVIDENCE_STALE",
  scopeUnsatisfied: "ASSURANCE_SCOPE_UNSATISFIED",
} as const);

export type ConformanceDisposition = (typeof conformanceDispositions)[keyof typeof conformanceDispositions];

const criterionIri = (name: string): string => `urn:usf:classification-criterion:${name}`;
const ruleIri = (name: string): string => `urn:usf:conformance-procedure:${name}`;

export interface ClassifiedUnit {
  readonly unit: string;
  readonly classification: string;
  readonly criterion: string;
}

export interface ImplementationDenominator {
  readonly population: number;
  readonly byClassification: Readonly<Record<string, number>>;
  readonly unaccounted: readonly string[];
  readonly nonConforming: readonly string[];
  readonly deferred: readonly string[];
}

export interface RequirementVerdict {
  readonly requirement: string;
  readonly canonicalName: string;
  readonly conformanceProcedure: string | null;
  readonly severity: string | null;
  readonly scope: string | null;
  readonly disposition: ConformanceDisposition;
  readonly findings: readonly string[];
  readonly reason: string | null;
}

export interface ArchitectureConformanceVerdict {
  readonly schema: "urn:usf:architecture-conformance-verdict:1";
  readonly architecture: string | null;
  readonly assuranceSet: string;
  readonly scope: string;
  readonly declarationDigest: string;
  readonly populationDigest: string;
  readonly producer: string;
  readonly denominator: ImplementationDenominator;
  readonly classifications: readonly ClassifiedUnit[];
  readonly requirements: readonly RequirementVerdict[];
  readonly disposition: ConformanceDisposition;
}

export interface ReleaseAssuranceResult {
  readonly schema: "urn:usf:release-assurance-result:1";
  readonly claim: string;
  readonly required: readonly string[];
  readonly satisfied: readonly string[];
  readonly missing: readonly string[];
  readonly failed: readonly string[];
  readonly disposition: ConformanceDisposition;
}

function startsWithRoot(unit: string, root: string): boolean {
  return unit === root || unit.startsWith(root.endsWith("/") ? root : `${root}/`);
}

function criterionHolds(
  criterion: string,
  classification: ClassificationDeclaration,
  unit: string,
  declaration: ArchitectureDeclaration,
  reachable: ReadonlySet<string>,
): boolean | null {
  switch (criterion) {
    case criterionIri("reachable-from-runtime-entry-point"):
      return reachable.has(unit);
    case criterionIri("named-as-work-write-path"):
      return declaration.workWritePaths.includes(unit);
    case criterionIri("named-in-validation-runtime-closure"):
      return declaration.validationClosureFiles.includes(unit);
    case criterionIri("named-by-enforcement-binding"):
      return declaration.enforcementBindings.some((binding) => binding.modules.includes(unit));
    case criterionIri("declared-by-disposition-decision"):
      return declaration.dispositionDecisions.some((decision) =>
        decision.classifiesAs === classification.iri
        && (decision.units.includes(unit) || decision.roots.some((root) => startsWithRoot(unit, root))));
    case criterionIri("within-generated-code-boundary"):
      return declaration.generatedCodeLocations.some((location) => startsWithRoot(unit, location));
    case criterionIri("no-criterion-satisfied"):
      return true;
    default:
      return null;
  }
}

export interface ClassificationResult {
  readonly classified: readonly ClassifiedUnit[];
  readonly unimplementedCriteria: readonly string[];
}

/**
 * Assigns every population member exactly one classification, taking the first
 * whose criterion holds in the declared precedence order. A criterion this
 * evaluator does not implement is reported rather than skipped: skipping it
 * would let a unit fall through to a weaker classification and read as
 * accounted for.
 */
export function classifyImplementation(declaration: ArchitectureDeclaration, observation: ArchitectureObservation): ClassificationResult {
  const reachable = new Set(observation.runtimeReachable);
  const unimplemented = new Set<string>();
  const classified: ClassifiedUnit[] = [];
  for (const unit of observation.population) {
    let assigned: ClassifiedUnit | null = null;
    for (const classification of declaration.classifications) {
      const holds = criterionHolds(classification.criterion, classification, unit, declaration, reachable);
      if (holds === null) {
        unimplemented.add(classification.criterion);
        continue;
      }
      if (holds) {
        assigned = { unit, classification: classification.iri, criterion: classification.criterion };
        break;
      }
    }
    if (assigned !== null) classified.push(assigned);
  }
  return { classified, unimplementedCriteria: [...unimplemented].sort() };
}

function denominatorOf(
  declaration: ArchitectureDeclaration,
  observation: ArchitectureObservation,
  classified: readonly ClassifiedUnit[],
): ImplementationDenominator {
  const byIri = new Map(declaration.classifications.map((each) => [each.iri, each]));
  const counts: Record<string, number> = {};
  for (const classification of declaration.classifications) counts[classification.iri] = 0;
  const nonConforming: string[] = [];
  const deferred: string[] = [];
  const seen = new Set<string>();
  for (const entry of classified) {
    seen.add(entry.unit);
    counts[entry.classification] = (counts[entry.classification] ?? 0) + 1;
    const declared = byIri.get(entry.classification);
    if (declared !== undefined && !declared.conforming) nonConforming.push(entry.unit);
    if (declared !== undefined && declared.defersArchitectureJudgement) deferred.push(entry.unit);
  }
  return {
    population: observation.population.length,
    byClassification: Object.freeze({ ...counts }),
    unaccounted: observation.population.filter((unit) => !seen.has(unit)).sort(),
    nonConforming: nonConforming.sort(),
    deferred: deferred.sort(),
  };
}

interface RuleContext {
  readonly declaration: ArchitectureDeclaration;
  readonly observation: ArchitectureObservation;
  readonly denominator: ImplementationDenominator;
  readonly unimplementedCriteria: readonly string[];
  readonly judged: ReadonlySet<string>;
  readonly deferred: ReadonlySet<string>;
  readonly layerOfUnit: ReadonlyMap<string, string>;
  readonly componentOfUnit: ReadonlyMap<string, string>;
}

function componentIndex(declaration: ArchitectureDeclaration, observation: ArchitectureObservation): { component: Map<string, string>; layer: Map<string, string> } {
  const component = new Map<string, string>();
  const layer = new Map<string, string>();
  const ordered = [...declaration.components].sort((left, right) => {
    const leftDepth = Math.max(...left.locations.map((each) => each.length), 0);
    const rightDepth = Math.max(...right.locations.map((each) => each.length), 0);
    return rightDepth - leftDepth || left.iri.localeCompare(right.iri);
  });
  for (const unit of observation.population) {
    for (const declared of ordered) {
      if (!declared.locations.some((location) => startsWithRoot(unit, location))) continue;
      component.set(unit, declared.iri);
      if (declared.layer !== null) layer.set(unit, declared.layer);
      break;
    }
  }
  return { component, layer };
}

function evaluateRule(rule: string, context: RuleContext): { findings: string[] } | null {
  const { declaration, observation, denominator, judged, deferred, layerOfUnit, componentOfUnit } = context;
  switch (rule) {
    case ruleIri("implementation-accounting"): {
      const findings = denominator.unaccounted.map((unit) => `unaccounted implementation unit: ${unit}`);
      for (const criterion of context.unimplementedCriteria) findings.push(`classification criterion has no implemented decision procedure: ${criterion}`);
      return { findings };
    }
    case ruleIri("runtime-reachability"):
      return { findings: denominator.nonConforming.map((unit) => `implementation unit is reachable from no declared runtime entry point and carries no legitimate classification: ${unit}`) };
    case ruleIri("entry-point-integrity"):
      return { findings: observation.absentEntryPointModules.map((module) => `declared runtime entry point resolves to no implementation unit: ${module}`) };
    case ruleIri("import-resolution"):
      return { findings: observation.unresolvedImports.map((each) => `unresolved relative import: ${each.from} to ${each.specifier}`) };
    case ruleIri("component-ownership"): {
      const boundaryScopes = declaration.moduleBoundaries.flatMap((boundary) => boundary.scopes);
      const findings: string[] = [];
      for (const unit of observation.population) {
        if (deferred.has(unit) || componentOfUnit.has(unit)) continue;
        if (boundaryScopes.some((scope) => startsWithRoot(unit, scope))) continue;
        findings.push(`implementation unit belongs to no declared component and no declared excluded boundary: ${unit}`);
      }
      return { findings };
    }
    case ruleIri("dependency-direction"): {
      const findings: string[] = [];
      const permitted = new Set<string>();
      const forbidden = new Set<string>();
      const required: Array<{ from: string; to: string; iri: string }> = [];
      for (const declared of declaration.dependencyRules) {
        const key = `${declared.from} ${declared.to}`;
        if (declared.kind === "forbids") forbidden.add(key);
        if (declared.kind === "permits") permitted.add(key);
        if (declared.kind === "requires") required.push({ from: declared.from, to: declared.to, iri: declared.iri });
      }
      for (const edge of observation.internalImports) {
        if (!judged.has(edge.from) || !judged.has(edge.to)) continue;
        const fromLayer = layerOfUnit.get(edge.from);
        const toLayer = layerOfUnit.get(edge.to);
        if (fromLayer === undefined || toLayer === undefined || fromLayer === toLayer) continue;
        if (forbidden.has(`${fromLayer} ${toLayer}`)) findings.push(`forbidden dependency: ${edge.from} to ${edge.to} crosses ${fromLayer} to ${toLayer}`);
        else if (!permitted.has(`${fromLayer} ${toLayer}`)) findings.push(`undeclared dependency direction: ${edge.from} to ${edge.to} crosses ${fromLayer} to ${toLayer}`);
      }
      const observedEdges = new Set<string>();
      for (const edge of observation.internalImports) {
        const fromLayer = layerOfUnit.get(edge.from);
        const toLayer = layerOfUnit.get(edge.to);
        if (fromLayer !== undefined && toLayer !== undefined) observedEdges.add(`${fromLayer} ${toLayer}`);
        const fromComponent = componentOfUnit.get(edge.from);
        const toComponent = componentOfUnit.get(edge.to);
        if (fromComponent !== undefined && toComponent !== undefined) observedEdges.add(`${fromComponent} ${toComponent}`);
      }
      for (const each of required) {
        if (!observedEdges.has(`${each.from} ${each.to}`)) findings.push(`required dependency is absent: ${each.from} to ${each.to} (${each.iri})`);
      }
      return { findings };
    }
    case ruleIri("cycle-boundary"): {
      const findings: string[] = [];
      for (const policy of declaration.cyclePolicies) {
        if (policy.cyclesPermitted) continue;
        const permittedMembers = new Set(policy.permittedCycleMembers);
        for (const member of observation.cycleMembers) {
          if (!judged.has(member) || permittedMembers.has(member)) continue;
          findings.push(`implementation unit participates in an import cycle outside the declared exception: ${member}`);
        }
      }
      return { findings };
    }
    case ruleIri("product-deferment"): {
      const findings: string[] = [];
      for (const unit of denominator.deferred) {
        const owning = declaration.dispositionDecisions.filter((decision) =>
          decision.units.includes(unit) || decision.roots.some((root) => startsWithRoot(unit, root)));
        if (owning.length === 0 || owning.every((decision) => decision.owner === null)) {
          findings.push(`deferred implementation unit names no owner: ${unit}`);
        }
      }
      for (const edge of observation.internalImports) {
        if (judged.has(edge.from) && deferred.has(edge.to)) findings.push(`foundation implementation depends on deferred product implementation: ${edge.from} to ${edge.to}`);
      }
      return { findings };
    }
    case ruleIri("module-boundary"): {
      const findings: string[] = [];
      for (const boundary of declaration.moduleBoundaries) {
        for (const edge of observation.internalImports) {
          const targetInScope = boundary.scopes.some((scope) => startsWithRoot(edge.to, scope));
          const sourceInScope = boundary.scopes.some((scope) => startsWithRoot(edge.from, scope));
          if (targetInScope && !sourceInScope) findings.push(`module boundary crossed: ${edge.from} to ${edge.to} (${boundary.iri})`);
        }
      }
      return { findings };
    }
    default:
      return null;
  }
}

export interface EvaluateInput {
  readonly declaration: ArchitectureDeclaration;
  readonly observation: ArchitectureObservation;
  readonly assuranceSet: string;
  readonly expectedPopulationDigest?: string;
}

/** Evaluates one assurance set's requirements against one observation. */
export function evaluateArchitectureConformance(input: EvaluateInput): ArchitectureConformanceVerdict {
  const { declaration, observation, assuranceSet } = input;
  const set = declaration.assuranceSets.find((each) => each.iri === assuranceSet);
  const classification = classifyImplementation(declaration, observation);
  const denominator = denominatorOf(declaration, observation, classification.classified);
  const byIri = new Map(declaration.classifications.map((each) => [each.iri, each]));
  const deferred = new Set(denominator.deferred);
  const judged = new Set(classification.classified
    .filter((entry) => !(byIri.get(entry.classification)?.defersArchitectureJudgement ?? false))
    .map((entry) => entry.unit));
  const index = componentIndex(declaration, observation);
  const context: RuleContext = {
    declaration,
    observation,
    denominator,
    unimplementedCriteria: classification.unimplementedCriteria,
    judged,
    deferred,
    layerOfUnit: index.layer,
    componentOfUnit: index.component,
  };

  const staleReason = observation.declarationDigest !== declarationDigest(declaration)
    ? "the observation was produced against a different architecture declaration"
    : input.expectedPopulationDigest !== undefined && input.expectedPopulationDigest !== observation.populationDigest
      ? "the observation was produced against a different implementation tree"
      : null;

  const requirements: RequirementVerdict[] = [];
  for (const requirementIri of set?.members ?? []) {
    const declared = declaration.requirements.find((each) => each.iri === requirementIri);
    const base = {
      requirement: requirementIri,
      canonicalName: declared?.canonicalName ?? requirementIri,
      conformanceProcedure: declared?.conformanceProcedure ?? null,
      severity: declared?.severity ?? null,
      scope: declared?.assuranceScope ?? null,
    };
    if (staleReason !== null) {
      requirements.push({ ...base, disposition: conformanceDispositions.evidenceStale, findings: [], reason: staleReason });
      continue;
    }
    if (declared === undefined || declared.conformanceProcedure === null) {
      requirements.push({ ...base, disposition: conformanceDispositions.evidenceMissing, findings: [], reason: "the requirement declares no conformance procedure" });
      continue;
    }
    if (declared.assuranceScope !== null && declared.assuranceScope !== observation.scope) {
      requirements.push({ ...base, disposition: conformanceDispositions.scopeUnsatisfied, findings: [], reason: `the requirement is declared at ${declared.assuranceScope} and the observation covers ${observation.scope}` });
      continue;
    }
    const outcome = evaluateRule(declared.conformanceProcedure, context);
    if (outcome === null) {
      requirements.push({ ...base, disposition: conformanceDispositions.evidenceMissing, findings: [], reason: `no implemented decision procedure for ${declared.conformanceProcedure}` });
      continue;
    }
    requirements.push({
      ...base,
      disposition: outcome.findings.length === 0 ? conformanceDispositions.conforming : conformanceDispositions.failed,
      findings: outcome.findings,
      reason: null,
    });
  }

  const dispositionOf = (): ConformanceDisposition => {
    if (requirements.some((each) => each.disposition === conformanceDispositions.evidenceStale)) return conformanceDispositions.evidenceStale;
    if (requirements.some((each) => each.disposition === conformanceDispositions.evidenceMissing)) return conformanceDispositions.evidenceMissing;
    if (requirements.some((each) => each.disposition === conformanceDispositions.failed)) return conformanceDispositions.failed;
    if (requirements.some((each) => each.disposition === conformanceDispositions.scopeUnsatisfied)) return conformanceDispositions.scopeUnsatisfied;
    if (requirements.length === 0) return conformanceDispositions.evidenceMissing;
    return conformanceDispositions.conforming;
  };

  return {
    schema: "urn:usf:architecture-conformance-verdict:1",
    architecture: declaration.architecture,
    assuranceSet,
    scope: observation.scope,
    declarationDigest: observation.declarationDigest,
    populationDigest: observation.populationDigest,
    producer: observation.producer,
    denominator,
    classifications: classification.classified,
    requirements,
    disposition: dispositionOf(),
  };
}

/**
 * Composes assurance sets into one release claim, and fails closed on absence.
 * A required set with no verdict is missing evidence and is reported as such,
 * which is a different answer from a verdict that failed.
 */
export function composeReleaseAssurance(
  declaration: ArchitectureDeclaration,
  claimIri: string,
  verdicts: readonly ArchitectureConformanceVerdict[],
): ReleaseAssuranceResult {
  const claim = declaration.releaseClaims.find((each) => each.iri === claimIri);
  const required = claim?.dependsOn ?? [];
  const satisfied: string[] = [];
  const missing: string[] = [];
  const failed: string[] = [];
  for (const set of required) {
    const verdict = verdicts.find((each) => each.assuranceSet === set);
    if (verdict === undefined) missing.push(set);
    else if (verdict.disposition === conformanceDispositions.conforming) satisfied.push(set);
    else failed.push(set);
  }
  const disposition: ConformanceDisposition = claim === undefined || missing.length > 0
    ? conformanceDispositions.evidenceMissing
    : failed.length > 0
      ? conformanceDispositions.failed
      : conformanceDispositions.conforming;
  return {
    schema: "urn:usf:release-assurance-result:1",
    claim: claimIri,
    required,
    satisfied: satisfied.sort(),
    missing: missing.sort(),
    failed: failed.sort(),
    disposition,
  };
}
