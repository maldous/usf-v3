import { canonicalDigest } from "../core/canonical.ts";
import type { SemanticGraph } from "../graph/index.ts";

/**
 * Facet satisfaction is derived from evidence, never authored.
 *
 * A facet declares what "done" means for one dimension of a capability. Its own
 * declaration is a requirement, and a requirement cannot be evidence that it is
 * met. Every satisfied verdict here names the evidence that produced it; a facet
 * with no evidence is NOT_ASSESSED, which is deliberately not the same as
 * UNSATISFIED.
 */
const P = "urn:usf:predicate:";

export type FacetState = "NOT_ASSESSED" | "SATISFIED" | "UNSATISFIED" | "BLOCKED" | "STALE" | "NOT_APPLICABLE";

export interface FacetVerdict {
  readonly facet: string;
  readonly facetKind: string | null;
  readonly capability: string | null;
  readonly state: FacetState;
  /** What produced this verdict. Empty for NOT_ASSESSED. */
  readonly evidence: readonly string[];
  readonly reason: string;
}

/**
 * Evidence classes each facet kind accepts. The ten kinds share evaluation
 * semantics, so one function serves 670 facets rather than 670 bespoke checks.
 */
export const facetEvidenceRequirement: Readonly<Record<string, Readonly<{
  evidenceClass: string; requirement: string;
}>>> = Object.freeze({
  contracts: Object.freeze({ evidenceClass: "realized-artefact",
    requirement: "A contract artefact for the capability exists at its canonical path." }),
  statemodel: Object.freeze({ evidenceClass: "realized-artefact",
    requirement: "A state model artefact exists, or a lifecycle declaration covers the capability." }),
  errormodel: Object.freeze({ evidenceClass: "realized-artefact",
    requirement: "An error catalogue artefact exists covering the capability." }),
  permissions: Object.freeze({ evidenceClass: "realized-artefact",
    requirement: "A permission declaration exists for the capability." }),
  uisemantics: Object.freeze({ evidenceClass: "realized-artefact",
    requirement: "A UI semantic model artefact exists." }),
  auditmodel: Object.freeze({ evidenceClass: "realized-artefact",
    requirement: "An audit model artefact exists." }),
  lifecycle: Object.freeze({ evidenceClass: "runtime-composition",
    requirement: "A runtime composition places the capability's services in a declared mode." }),
  readinessmodel: Object.freeze({ evidenceClass: "runtime-composition",
    requirement: "A runtime composition exists and the capability's services are declared." }),
  validation: Object.freeze({ evidenceClass: "validator-outcome",
    requirement: "A named validator ran over a realized artefact under a recorded authority snapshot and returned a result." }),
  // The assessment established that the legacy proof invariant was exactly "the
  // realized artefact validates against its declared contract". That is what a
  // validator outcome records, so proof reads the same evidence class rather
  // than requiring a separate proof object.
  proof: Object.freeze({ evidenceClass: "validator-outcome",
    requirement: "A named validator ran over a realized artefact and returned a result; the separate proof object is superseded." }),
});

/**
 * One executed behavioural outcome for one facet. It is produced by running the
 * capability's conformance test against the real module; nothing here can be
 * authored, and a requirement is never its own evidence.
 */
export interface ConformanceEvidenceEntry {
  readonly executed: boolean;
  readonly passed: boolean;
  /** The recorded run no longer binds the current module or test bytes. */
  readonly stale: boolean;
  readonly evidence: string;
  readonly detail: string | null;
}

export interface EvidenceIndex {
  /** Realized artefact paths that exist, mapped to their content digest. */
  readonly realizedArtefacts: ReadonlyMap<string, string>;
  /** True when a runtime composition artefact has been realized. */
  readonly runtimeComposed: boolean;
  /** Validator outcome identities available as evidence. */
  readonly validatorOutcomes: readonly string[];
  /** Proof outcome identities available as evidence. */
  readonly proofOutcomes: readonly string[];
  /** Executed behavioural outcomes, keyed by the facet IRI they were named for. */
  readonly conformanceOutcomes: ReadonlyMap<string, ConformanceEvidenceEntry>;
}

function values(graph: SemanticGraph, subject: string, predicate: string): readonly string[] {
  return Object.freeze(graph.quads
    .filter((quad) => quad.subject === subject && quad.predicate === `${P}${predicate}`)
    .map((quad) => quad.object).sort());
}

/**
 * Evaluate every declared facet against the evidence index. Nothing here reads a
 * stored satisfaction value: the verdict is recomputed from evidence each time,
 * so it cannot drift from what the evidence supports.
 */
export function evaluateFacets(graph: SemanticGraph, evidence: EvidenceIndex): readonly FacetVerdict[] {
  const contractFor = new Map<string, string>();
  for (const quad of graph.quads) {
    if (quad.predicate !== `${P}definesCompletionFor`) continue;
    contractFor.set(quad.subject, quad.object);
  }
  const facetOwner = new Map<string, string>();
  for (const quad of graph.quads) {
    if (quad.predicate !== `${P}declaresFacet`) continue;
    facetOwner.set(quad.object, quad.subject);
  }
  const facets = graph.quads
    .filter((quad) => quad.predicate === `${P}type` && quad.object === "urn:usf:type:DeliveryFacet")
    .map((quad) => quad.subject).sort();

  return Object.freeze(facets.map((facet) => {
    const kindIri = values(graph, facet, "facetKind")[0] ?? null;
    const kind = kindIri?.split(":").pop() ?? null;
    const contract = facetOwner.get(facet) ?? null;
    const capability = contract === null ? null : contractFor.get(contract) ?? null;

    // Applicability is authored authority recovered from V1, not inferred here.
    if (values(graph, facet, "facetApplicability")[0] === "NOT_APPLICABLE") {
      return Object.freeze({
        facet, facetKind: kind, capability, state: "NOT_APPLICABLE" as const, evidence: Object.freeze([]),
        reason: values(graph, facet, "inapplicabilityBasis")[0]
          ?? "Authored as inapplicable: the capability's semantic nature makes this requirement irrelevant.",
      });
    }
    // The evidence class the statement actually admits decides what can satisfy
    // it. An artefact cannot evidence a behavioural, state, audit or
    // authorization requirement.
    const declaredEvidence = values(graph, facet, "admissibleEvidenceClass")[0] ?? null;
    if (declaredEvidence === "implementation-conformance") {
      // Only an executed behavioural outcome can evidence a behaviour, state,
      // audit or authorization requirement. A realized specification artefact
      // cannot, and neither can the presence of a module at its canonical path.
      const outcome = evidence.conformanceOutcomes.get(facet);
      if (outcome === undefined || !outcome.executed) {
        return Object.freeze({
          facet, facetKind: kind, capability, state: "NOT_ASSESSED" as const, evidence: Object.freeze([]),
          reason: outcome?.detail
            ?? "This requirement asserts product behaviour, state, audit or authorization. Only an executed behavioural check against the implementation can evidence it, and none has run.",
        });
      }
      if (outcome.stale) {
        return Object.freeze({
          facet, facetKind: kind, capability, state: "STALE" as const, evidence: Object.freeze([outcome.evidence]),
          reason: "A behavioural outcome exists but the implementation or its conformance test has changed since it was observed, so it no longer describes the current code.",
        });
      }
      return outcome.passed
        ? Object.freeze({
            facet, facetKind: kind, capability, state: "SATISFIED" as const, evidence: Object.freeze([outcome.evidence]),
            reason: "A behavioural subtest named for this requirement executed against the implementation module inside the repository confinement and passed.",
          })
        : Object.freeze({
            facet, facetKind: kind, capability, state: "UNSATISFIED" as const, evidence: Object.freeze([outcome.evidence]),
            reason: outcome.detail ?? "A behavioural subtest named for this requirement executed against the implementation module and failed.",
          });
    }
    if (declaredEvidence === "realized-artefact") {
      const realized = [...evidence.realizedArtefacts.keys()].sort();
      return realized.length === 0
        ? Object.freeze({
            facet, facetKind: kind, capability, state: "NOT_ASSESSED" as const, evidence: Object.freeze([]),
            reason: "This requirement admits a realized artefact as evidence, but none is realized.",
          })
        : Object.freeze({
            facet, facetKind: kind, capability, state: "SATISFIED" as const,
            evidence: Object.freeze(realized.slice(0, 4).map((path) => `${path}@${evidence.realizedArtefacts.get(path)!.slice(0, 19)}`)),
            reason: "A realized artefact evidences this content requirement.",
          });
    }
    if (declaredEvidence === "validator-outcome") {
      return evidence.validatorOutcomes.length === 0
        ? Object.freeze({
            facet, facetKind: kind, capability, state: "BLOCKED" as const, evidence: Object.freeze([]),
            reason: "This requirement admits a validator outcome, which must be produced by running a check and cannot be authored.",
          })
        : Object.freeze({
            facet, facetKind: kind, capability, state: "SATISFIED" as const,
            evidence: evidence.validatorOutcomes, reason: "A named validator ran and returned a result.",
          });
    }
    if (declaredEvidence === null) {
      return Object.freeze({
        facet, facetKind: kind, capability, state: "NOT_ASSESSED" as const, evidence: Object.freeze([]),
        reason: "No admissible evidence class is declared for this facet, so no verdict can be derived.",
      });
    }
    const rule = kind === null ? undefined : facetEvidenceRequirement[kind];
    if (rule === undefined) {
      return Object.freeze({
        facet, facetKind: kind, capability, state: "NOT_ASSESSED" as const, evidence: Object.freeze([]),
        reason: "No evidence requirement is declared for this facet kind, so no verdict can be derived.",
      });
    }
    if (rule.evidenceClass === "realized-artefact") {
      // Evidence is a realized artefact of the matching kind. A capability's own
      // declaration is not admissible.
      const realized = [...evidence.realizedArtefacts.keys()]
        .filter((path) => path.includes(`/${kind === "contracts" ? "contracts" : kind}/`)
          || (kind === "uisemantics" && path.includes("/ui/models/"))
          || (kind === "errormodel" && path.includes("/ui/errors/"))
          || (kind === "auditmodel" && path.includes("/audit/"))
          || (kind === "permissions" && path.includes("/permissions/"))
          || (kind === "statemodel" && path.includes("/states/")))
        .sort();
      if (realized.length === 0) {
        return Object.freeze({
          facet, facetKind: kind, capability, state: "NOT_ASSESSED" as const, evidence: Object.freeze([]),
          reason: `${rule.requirement} No such artefact is realized yet.`,
        });
      }
      return Object.freeze({
        facet, facetKind: kind, capability, state: "SATISFIED" as const,
        evidence: Object.freeze(realized.map((path) => `${path}@${evidence.realizedArtefacts.get(path)!.slice(0, 19)}`)),
        reason: rule.requirement,
      });
    }
    if (rule.evidenceClass === "runtime-composition") {
      return evidence.runtimeComposed
        ? Object.freeze({
            facet, facetKind: kind, capability, state: "SATISFIED" as const,
            evidence: Object.freeze(["runtime-composition"]), reason: rule.requirement,
          })
        : Object.freeze({
            facet, facetKind: kind, capability, state: "NOT_ASSESSED" as const, evidence: Object.freeze([]),
            reason: `${rule.requirement} No runtime composition is realized yet.`,
          });
    }
    const outcomes = rule.evidenceClass === "validator-outcome" ? evidence.validatorOutcomes : evidence.proofOutcomes;
    if (outcomes.length === 0) {
      return Object.freeze({
        facet, facetKind: kind, capability, state: "BLOCKED" as const, evidence: Object.freeze([]),
        reason: `${rule.requirement} No ${rule.evidenceClass} exists, and one cannot be authored: it must be produced by running the check.`,
      });
    }
    return Object.freeze({
      facet, facetKind: kind, capability, state: "SATISFIED" as const,
      evidence: Object.freeze(outcomes), reason: rule.requirement,
    });
  }));
}

export interface FacetSummary {
  readonly schema: "urn:usf:facet-satisfaction:1";
  readonly evaluated: true;
  readonly facetCount: number;
  readonly stateCounts: Readonly<Record<FacetState, number>>;
  readonly byKind: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly capabilitiesFullySatisfied: number;
  readonly capabilitiesWithRemainingWork: number;
  readonly verdictDigest: string;
  readonly nonClaims: readonly string[];
}

export function summariseFacets(verdicts: readonly FacetVerdict[]): FacetSummary {
  const stateCounts: Record<FacetState, number> = {
    NOT_ASSESSED: 0, SATISFIED: 0, UNSATISFIED: 0, BLOCKED: 0, STALE: 0, NOT_APPLICABLE: 0,
  };
  const byKind: Record<string, Record<string, number>> = {};
  const byCapability = new Map<string, { total: number; satisfied: number }>();
  for (const verdict of verdicts) {
    stateCounts[verdict.state] += 1;
    const kind = verdict.facetKind ?? "(none)";
    byKind[kind] = byKind[kind] ?? {};
    byKind[kind]![verdict.state] = (byKind[kind]![verdict.state] ?? 0) + 1;
    if (verdict.capability === null) continue;
    // A capability is complete when every applicable requirement is satisfied.
    // An inapplicable requirement is excluded from the denominator rather than
    // counted as satisfied.
    if (verdict.state === "NOT_APPLICABLE") continue;
    const entry = byCapability.get(verdict.capability) ?? { total: 0, satisfied: 0 };
    entry.total += 1;
    if (verdict.state === "SATISFIED") entry.satisfied += 1;
    byCapability.set(verdict.capability, entry);
  }
  return Object.freeze({
    schema: "urn:usf:facet-satisfaction:1" as const,
    evaluated: true as const,
    facetCount: verdicts.length,
    stateCounts: Object.freeze(stateCounts),
    byKind: Object.freeze(byKind),
    capabilitiesFullySatisfied: [...byCapability.values()].filter((entry) => entry.total > 0 && entry.total === entry.satisfied).length,
    capabilitiesWithRemainingWork: [...byCapability.values()].filter((entry) => entry.satisfied < entry.total).length,
    verdictDigest: canonicalDigest(verdicts),
    nonClaims: Object.freeze([
      "Every satisfied verdict names the evidence that produced it. No verdict is read from a stored satisfaction value.",
      "NOT_ASSESSED means no admissible evidence exists yet. It is not a claim that the facet is unsatisfied.",
      "An implementation-conformance verdict is derived from an executed behavioural subtest named for the facet. The presence of a module at its canonical path is never admissible for one.",
      "BLOCKED means the required evidence class must be produced by running a check and cannot be authored.",
      "NOT_APPLICABLE is authored authority recovered from V1, not an absence of evidence, and is excluded from the completion denominator rather than counted as satisfied.",
    ]),
  });
}
