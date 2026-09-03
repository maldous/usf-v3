// Derive ANQR's experience projection from the USF semantic graph.
//
// Same relationship as the architecture rules: the graph is authority, this is
// a projection, and a drift check compares a fresh derivation against the
// committed output. The product consumes the projection so that the state
// machine, the join constraints and the role bindings are read from authority
// rather than restated in TypeScript where they could quietly diverge.
//
//   node scripts/derive-anqr-experience.mjs [output-path]

import { fileURLToPath } from "node:url";
import { loadSemanticGraph, objectValues } from "../src/graph/index.ts";

const P = "urn:usf:predicate:";
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const g = loadSemanticGraph(repositoryRoot, "graph/manifests/anqr-experience.json");
const vals = (s, p) => objectValues(g, s, P + p);
const one = (s, p) => { const v = vals(s, p); return v.length ? v[0] : null; };
const typed = (t) => [...new Set(g.quads.filter((q) => q.predicate === `${P}type` && q.object === t).map((q) => q.subject))].sort();
const local = (iri) => (iri === null ? null : iri.split(":").pop());
// A pattern IRI ends with its version, so the last segment is "1" rather than
// the name. Caught by the integrity check reporting five unknown patterns all
// called "1".
const patternName = (iri) => {
  if (iri === null) return null;
  const parts = iri.split(":");
  return parts[parts.length - 2] ?? null;
};

const PROFILE = "urn:anqr:experience-profile-revision:1";
const DESIGN = "urn:anqr:design-profile-revision:1";
const PACK = "urn:anqr:ui-implementation-pack:preact:1";

const patterns = typed("urn:usf:type:FutureUsePattern").map((p) => ({
  iri: p, name: one(p, "canonicalName"), version: one(p, "version"),
  purpose: one(p, "patternPurpose"),
  anatomy: vals(p, "patternAnatomy"),
  requiresState: vals(p, "requiresInteractionState").map(local).sort(),
  keyboard: vals(p, "keyboardBehaviour"),
  focus: vals(p, "focusBehaviour"),
  assistive: vals(p, "assistiveSemantics"),
  responsive: vals(p, "responsiveBehaviour"),
  prohibited: vals(p, "prohibitedShortcut"),
}));

const journeys = typed("urn:usf:type:ProductJourney").map((j) => ({
  iri: j, name: one(j, "canonicalName"), actor: local(one(j, "forActor")),
  purpose: one(j, "journeyBusinessPurpose"), entryPoint: one(j, "journeyEntryPoint"),
  success: one(j, "journeySuccessOutcome"), failure: one(j, "journeyFailureOutcome"),
  requiresAnonymity: one(j, "requiresAnonymity") === "true",
  steps: vals(j, "hasJourneyStep").map((s) => ({
    iri: s, name: one(s, "canonicalName"), order: Number(one(s, "stepOrder")),
    objective: one(s, "objective"),
    capabilities: vals(s, "stepUsesCapability").map(local).sort(),
    foundationCapabilities: vals(s, "stepUsesFoundationCapability").map(local).sort(),
    pattern: patternName(one(s, "stepSelectsPattern")),
  })).sort((a, b) => a.order - b.order),
}));

const actions = typed("urn:usf:type:ExperienceAction").map((a) => ({
  iri: a, name: one(a, "canonicalName"),
  capability: local(one(a, "actionInvokesCapability")),
  outcomes: vals(a, "actionOutcome").sort(),
  evidence: one(a, "actionEvidence"),
}));

const states = typed("urn:usf:type:ExperienceState").map((s) => ({
  iri: s, name: one(s, "canonicalName"),
  interactionState: local(one(s, "mapsToInteractionState")),
  entryCondition: one(s, "stateEntryCondition"),
  permits: vals(s, "permitsAction").map(local).sort(),
  withholds: vals(s, "withholdsAction").map(local).sort(),
  feedback: one(s, "stateFeedback"),
  accessibleMeaning: one(s, "stateAccessibleMeaning"),
  recoveryRoute: one(s, "stateRecoveryRoute"),
}));

const transitions = typed("urn:usf:type:StateTransition").map((t) => ({
  iri: t, name: one(t, "canonicalName"),
  from: local(one(t, "transitionFrom")), to: local(one(t, "transitionTo")),
  cause: one(t, "transitionCause"),
})).sort((a, b) => a.name.localeCompare(b.name));

const roles = typed("urn:usf:type:DesignRole").map((r) => ({
  iri: r, name: one(r, "canonicalName"), governs: one(r, "roleGoverns"),
}));

const bindings = vals(PACK, "hasBinding").map((b) => ({
  iri: b, name: one(b, "canonicalName"),
  element: one(b, "bindsSemanticElement"),
  unit: one(b, "bindsImplementationUnit"),
  location: one(b, "bindingLocation"),
})).sort((a, b) => a.name.localeCompare(b.name));

// The parameters this journey actually uses, with their declared domains and
// the join rules that constrain them. Projected so the join validator reads
// its constraints from authority.
const SLICE_PARAMETERS = [
  "payload", "errorCorrectionLevel", "symbolVersion", "maskPattern",
  "outputFormat", "moduleSizePx", "quietZoneModules",
  "foregroundColour", "backgroundColour", "minimumContrastRatio", "decodeVerification",
];
const parameters = SLICE_PARAMETERS.map((name) => {
  const iri = `urn:anqr:artefact-parameter:${name}`;
  const domain = `urn:anqr:artefact-parameter-domain:${name}`;
  return {
    iri, name,
    family: local(one(iri, "parameterFamily")),
    servesCapability: local(one(iri, "servesCapability")),
    domainKind: one(domain, "domainKind"),
    admissibleValues: vals(domain, "admissibleValue").sort(),
    minimum: one(domain, "minimumValue"),
    maximum: one(domain, "maximumValue"),
  };
}).filter((entry) => entry.domainKind !== null);

const joinRules = typed("urn:usf:type:ArtefactParameterJoinRule").map((r) => ({
  iri: r, name: one(r, "canonicalName"),
  kind: local(one(r, "joinRuleKind")),
  antecedent: local(one(r, "joinAntecedent")),
  antecedentValue: one(r, "joinAntecedentValue"),
  consequent: local(one(r, "joinConsequent")),
  reason: one(r, "joinRuleReason"),
})).filter((r) => SLICE_PARAMETERS.includes(r.antecedent) && SLICE_PARAMETERS.includes(r.consequent))
  .sort((a, b) => a.name.localeCompare(b.name));

const neutrality = typed("urn:usf:type:PatternNeutralityRule").map((r) => ({
  iri: r, invariant: one(r, "invariant"),
  forbiddenSubstrings: vals(r, "forbiddenSubstring").sort(),
  reason: one(r, "neutralityReason"),
}));

const payload = {
  authority: {
    experienceProfile: PROFILE,
    designProfile: DESIGN,
    implementationPack: PACK,
    patternCatalogue: one(PROFILE, "catalogueRevision"),
    productProfileRevision: one(PROFILE, "boundProfileRevision"),
    manifest: "graph/manifests/anqr-experience.json",
  },
  selectedPatterns: vals(PROFILE, "selectsPattern").map(patternName).sort(),
  designCharacter: one(DESIGN, "designCharacter"),
  contrastRequirement: Number(one(DESIGN, "contrastRequirement")),
  build: { command: one(PACK, "buildCommand"), output: one(PACK, "buildOutputLocation") },
  joinValidatorLocation: one(PACK, "joinValidatorLocation"),
  patterns, journeys, actions, states, transitions, roles, bindings,
  parameters, joinRules, neutrality,
};

const body = `${JSON.stringify(payload, null, 2)}\n`;
const out = process.argv[2];
if (out) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(out, body);
  console.log("wrote", out, body.length, "bytes");
} else process.stdout.write(body);
