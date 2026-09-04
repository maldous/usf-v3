// Derive ANQR's delivery projection from the USF semantic graph.
//
// Third projection on the same relationship as the architecture rules and the
// experience model: the graph is authority, this is a projection, and a drift
// check compares a fresh derivation against the committed output in both
// directions.
//
// What it carries is the part of delivery a product repository can check for
// itself without an environment: that every delivery requirement it declares
// resolves to a contract that exists, that each environment binding is either
// complete or explicitly unresolved with its decisions named, that every secret
// is a name and a resolver rather than a value, and that the promotion gates
// and rung ordering are the ones authority declares.
//
//   node scripts/derive-anqr-delivery.mjs [output-path]

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadSemanticGraph, objectValues } from "../src/graph/index.ts";

const P = "urn:usf:predicate:";
const A = "urn:anqr:predicate:";
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const g = loadSemanticGraph(repositoryRoot, "graph/manifests/anqr-application.json");

const vals = (s, p) => objectValues(g, s, p);
const one = (s, p) => { const v = vals(s, p); return v.length > 0 ? v[0] : null; };
const typed = (t) => [...new Set(g.quads
  .filter((q) => q.predicate === `${P}type` && q.object === t)
  .map((q) => q.subject))].sort();
const local = (iri) => (iri === null ? null : iri.slice(iri.lastIndexOf(":") + 1));

const REQUIREMENT_SET = "urn:anqr:delivery-requirement-set:1";

// ---- rungs, in their declared order ---------------------------------------
const rungs = typed("urn:usf:type:DeliveryRung")
  .map((iri) => ({
    name: local(iri),
    order: Number(one(iri, `${P}rungOrder`)),
    promotesTo: local(one(iri, `${P}promotesTo`)),
    providerRealism: local(one(iri, `${P}admitsProviderRealism`)),
    mutationPosture: local(one(iri, `${P}mutationPosture`)),
    requiresHumanApproval: one(iri, `${P}requiresHumanApproval`) === "true",
    requiresEvidenceClass: vals(iri, `${P}requiresEvidenceClass`).map(local).sort(),
  }))
  .sort((left, right) => left.order - right.order);

// ---- environments ----------------------------------------------------------
const environments = g.quads
  .filter((q) => q.predicate === `${P}belongsToRung`)
  .map((q) => ({ name: local(q.subject), rung: local(q.object) }))
  .sort((left, right) => left.name.localeCompare(right.name));

// ---- promotion gates -------------------------------------------------------
const gates = typed("urn:usf:type:PromotionGate").map((iri) => ({
  name: local(iri),
  from: local(one(iri, `${P}gateFrom`)),
  to: local(one(iri, `${P}gateTo`)),
  requiresHumanApproval: one(iri, `${P}requiresHumanApproval`) === "true",
  refuses: vals(iri, `${P}refusalReason`).map(local).sort(),
}));

// ---- what the product requires, and explicitly does not --------------------
const declaredContracts = new Set(typed("urn:usf:type:DeliveryContract"));
const required = vals(REQUIREMENT_SET, `${A}requiresDeliveryContract`).sort()
  .map((iri) => ({ contract: local(iri), declared: declaredContracts.has(iri) }));
const notRequired = vals(REQUIREMENT_SET, `${A}explicitlyNotRequired`).sort()
  .map((iri) => ({ contract: local(iri), declared: declaredContracts.has(iri), reason: one(iri, `${P}notRequiredReason`) }));

// ---- environment bindings --------------------------------------------------
// Typed EnvironmentBinding only. The parity dispositions carry a bindingStatus
// of their own kind, and folding them in here would report eight environment
// bindings where six exist.
const environmentBindings = new Set(typed("urn:usf:type:EnvironmentBinding"));
const bindings = g.quads
  .filter((q) => q.predicate === `${A}bindingStatus` && environmentBindings.has(q.subject))
  .map((q) => ({
    binding: local(q.subject),
    environment: local(one(q.subject, `${A}bindsEnvironment`)),
    status: q.object,
    contracts: vals(q.subject, `${A}bindsDeliveryContract`).map(local).sort(),
    unresolvedDecisions: vals(q.subject, `${A}unresolvedDecision`).length,
    requiresExternalAuthority: local(one(q.subject, `${A}requiresExternalAuthority`)),
  }))
  .sort((left, right) => left.binding.localeCompare(right.binding));

// ---- secrets: names, resolvers and consequences only -----------------------
const secrets = g.quads
  .filter((q) => q.predicate === `${A}secretResolver`)
  .map((q) => ({
    requirement: local(q.subject),
    resolver: local(q.object),
    consequence: one(q.subject, `${A}secretConsequence`),
  }))
  .sort((left, right) => left.requirement.localeCompare(right.requirement));

// ---- the external decisions staging and production still need --------------
const decisions = g.quads
  .filter((q) => q.predicate === `${A}isSecretValue`)
  .map((q) => ({
    decision: local(q.subject),
    secret: q.object === "true",
    contract: local(one(q.subject, `${A}requiresDeliveryContract`)),
    authority: local(one(q.subject, `${A}requiresExternalAuthority`)),
  }))
  .sort((left, right) => left.decision.localeCompare(right.decision));

// ---- capability delivery posture -------------------------------------------
const capabilityDelivery = [...new Set(g.quads
  .filter((q) => q.predicate === `${A}requiresDeliveryContract` && q.subject.startsWith("urn:anqr:delivery-capability:"))
  .map((q) => q.subject))].sort().map((iri) => ({
    capability: local(iri),
    contracts: vals(iri, `${A}requiresDeliveryContract`).map(local).sort(),
    ports: vals(iri, `${A}requiresDeliveryPort`).map(local).sort(),
    evidencePosture: local(one(iri, `${A}evidencePosture`)),
  }));

// Facets that are required and deliberately unrealised, so a derived work unit
// for one can be declined with a reason rather than looking like undone work.
const parityDispositions = g.quads
  .filter((q) => q.predicate === `${A}bindingStatus` && q.subject.startsWith("urn:anqr:parity-disposition:"))
  .map((q) => ({
    disposition: local(q.subject),
    status: q.object,
    appliesToFacet: local(one(q.subject, `${A}appliesToFacet`)),
    openDecisions: vals(q.subject, `${A}unresolvedDecision`).length,
  }))
  .sort((left, right) => left.disposition.localeCompare(right.disposition));

const projection = {
  schema: "urn:anqr:delivery-projection:1",
  authority: {
    manifest: "graph/manifests/anqr-application.json",
    requirementSet: REQUIREMENT_SET,
    profileRevision: local(one(REQUIREMENT_SET, `${A}bindsProfileRevision`)),
  },
  rungs,
  environments,
  gates,
  required,
  notRequired,
  bindings,
  parityDispositions,
  secrets,
  externalDecisions: decisions,
  capabilityDelivery,
  nonClaims: [
    "A projection is not authority. If this disagrees with the graph, the graph is right and this is stale.",
    "A declared requirement is not a provisioned resource, and a complete requirement set with no environment binding delivers nothing.",
    "No secret value appears here. A secret is a name, a resolver and a consequence.",
  ],
};

const output = process.argv[2] ?? null;
const text = `${JSON.stringify(projection, null, 2)}\n`;
if (output === null) process.stdout.write(text);
else writeFileSync(output, text);
