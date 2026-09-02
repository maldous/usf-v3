import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { loadSemanticGraph } from "../../src/graph/index.ts";
import {
  deriveCapabilityImplementationNeeds,
  readConformanceRule,
  readImplementationConvention,
} from "../../src/providers/implementation-work.ts";

/**
 * ANQR is a product realised against USF, not a part of USF.
 *
 * These are the properties that make that separation real rather than
 * documentary: the two profiles select disjoint work through disjoint
 * conventions, the product's dependency on the foundation is a small closure of
 * exact resources rather than the whole foundation, and a capability the
 * product does not claim produces no work.
 */
const canonicalRoot = resolve(import.meta.dirname, "../..");
const anqrManifest = "graph/products/anqr/manifest.json";
const coreManifest = "graph/manifests/v3-delivery.json";
const P = "urn:usf:predicate:";
const revision = "urn:anqr:profile-revision:2";

const anqr = loadSemanticGraph(canonicalRoot, anqrManifest);
const core = loadSemanticGraph(canonicalRoot, coreManifest);

function objects(graph: { quads: readonly { subject: string; predicate: string; object: string }[] },
  subject: string, predicate: string): readonly string[] {
  return graph.quads.filter((quad) => quad.subject === subject && quad.predicate === `${P}${predicate}`)
    .map((quad) => quad.object).sort();
}
function subjectsOfType(graph: { quads: readonly { subject: string; predicate: string; object: string }[] },
  type: string): readonly string[] {
  return [...new Set(graph.quads.filter((quad) => quad.predicate === `${P}type` && quad.object === type)
    .map((quad) => quad.subject))].sort();
}

test("the ANQR profile does not absorb the foundation's own capability set", () => {
  const anqrCapabilities = subjectsOfType(anqr, "urn:usf:type:DeliveryCapability");
  const coreCapabilities = subjectsOfType(core, "urn:usf:type:DeliveryCapability");
  assert.ok(anqrCapabilities.length > 0, "the profile must declare capabilities of its own");
  assert.ok(coreCapabilities.length > 0, "the foundation must still declare its own");
  // The point of the overlay: importing the foundation's delivery authority
  // would make every core capability look like product scope.
  assert.equal(anqrCapabilities.filter((iri) => coreCapabilities.includes(iri)).length, 0);
  assert.ok(anqrCapabilities.every((iri) => iri.startsWith("urn:anqr:")));
});

test("every declared capability carries a product reason and a satisfaction condition", () => {
  for (const capability of subjectsOfType(anqr, "urn:usf:type:DeliveryCapability")) {
    for (const predicate of ["userOutcome", "targetUser", "businessValue", "productScopeDisposition"]) {
      assert.equal(objects(anqr, capability, predicate).length, 1,
        `${capability} must state exactly one ${predicate}`);
    }
    assert.ok(objects(anqr, capability, "satisfactionCondition").length > 0,
      `${capability} must state what would satisfy it`);
    assert.ok(objects(anqr, capability, "justifiedByEvidenceSource").length > 0,
      `${capability} must name the evidence that justified declaring it`);
  }
});

test("no capability is reported satisfied, whatever its disposition", () => {
  for (const facet of subjectsOfType(anqr, "urn:usf:type:DeliveryFacet")) {
    assert.deepEqual(objects(anqr, facet, "satisfactionStatus"), ["not-assessed"],
      `${facet} must carry no authored satisfaction`);
  }
});

test("a capability the product does not claim produces no implementation work", () => {
  const convention = readImplementationConvention(anqr);
  const needs = deriveCapabilityImplementationNeeds(anqr, convention);
  const selected = new Set(needs.map((need) => need.capability));
  let claimed = 0;
  let unclaimed = 0;
  for (const capability of subjectsOfType(anqr, "urn:usf:type:DeliveryCapability")) {
    const disposition = objects(anqr, capability, "productScopeDisposition")[0] ?? "";
    const isClaimed = disposition.endsWith(":current") || disposition.endsWith(":experimental");
    if (isClaimed) { claimed += 1; assert.ok(selected.has(capability), `${capability} is claimed and must be selectable`); }
    else { unclaimed += 1; assert.ok(!selected.has(capability), `${capability} is not claimed and must not become work`); }
  }
  assert.ok(claimed > 0 && unclaimed > 0, "the profile must exercise both sides of the rule");
});

test("the product and the foundation select work through separate conventions", () => {
  const anqrConvention = readImplementationConvention(anqr);
  const coreConvention = readImplementationConvention(core);
  assert.notEqual(anqrConvention.convention, coreConvention.convention);
  // The product realises into its own repository; USF realises into itself.
  assert.equal(coreConvention.productRepository, null);
  assert.equal(anqrConvention.productRepository, "urn:anqr:repository:main");
  const anqrNeeds = deriveCapabilityImplementationNeeds(anqr, anqrConvention);
  const coreNeeds = deriveCapabilityImplementationNeeds(core, coreConvention);
  const corePaths = new Set(coreNeeds.map((need) => need.modulePath));
  assert.ok(anqrNeeds.length > 0 && coreNeeds.length > 0);
  // Paths are repository-relative and may coincide as strings; what must never
  // coincide is the capability they realise.
  const coreCapabilities = new Set(coreNeeds.map((need) => need.capability));
  assert.equal(anqrNeeds.filter((need) => coreCapabilities.has(need.capability)).length, 0);
  assert.ok(corePaths.size > 0);
});

test("product evidence is governed by the product's own conformance rule", () => {
  const anqrRule = readConformanceRule(anqr);
  const coreRule = readConformanceRule(core);
  assert.ok(anqrRule !== null && coreRule !== null);
  assert.notEqual(anqrRule.rule, coreRule.rule);
  assert.ok(anqrRule.rule.startsWith("urn:anqr:"));
});

test("the foundation dependency is a bounded closure of exact resources", () => {
  const binding = "urn:anqr:profile-foundation-binding:2";
  const seeds = objects(anqr, binding, "coreDependencySeed");
  assert.ok(seeds.length > 0, "the binding must declare what it depends on");
  assert.ok(seeds.every((seed) => seed.startsWith("urn:usf:")), "a seed names a foundation resource");
  // Every port bound must be a port the foundation actually declares, and must
  // be required by a stated product reason rather than provisioned on spec.
  const ports = seeds.filter((seed) => seed.startsWith("urn:usf:capability-port:"));
  const declaredPorts = new Set(subjectsOfType(core, "urn:usf:type:CapabilityPort"));
  for (const port of ports) assert.ok(declaredPorts.has(port), `${port} must be a declared foundation port`);
  for (const dependency of subjectsOfType(anqr, "urn:usf:type:ProfileFoundationDependency")) {
    assert.equal(objects(anqr, dependency, "requiresFoundationPort").length, 1);
    assert.equal(objects(anqr, dependency, "foundationDependencyReason").length, 1,
      `${dependency} must state the product reason that requires it`);
  }
  // A dependency the product does not currently need is declared and not seeded,
  // so deferring a capability also defers its infrastructure.
  const seeded = new Set(ports);
  for (const dependency of subjectsOfType(anqr, "urn:usf:type:ProfileFoundationDependency")) {
    const port = objects(anqr, dependency, "requiresFoundationPort")[0]!;
    const current = objects(anqr, dependency, "productScopeDisposition")[0]?.endsWith(":current") === true;
    assert.equal(seeded.has(port), current, `${port} is seeded exactly when the product currently needs it`);
  }
});

test("the profile names no provider technology as a product capability", () => {
  const forbidden = ["postgres", "keycloak", "redis", "stardog", "netlify", "sentry"];
  for (const capability of subjectsOfType(anqr, "urn:usf:type:DeliveryCapability")) {
    const name = objects(anqr, capability, "canonicalName")[0] ?? "";
    for (const technology of forbidden) {
      assert.ok(!name.toLowerCase().includes(technology),
        `${capability} names a provider technology; a product owns the requirement, the foundation owns the provider`);
    }
  }
});

test("the superseded revision keeps its meaning and stays empty", () => {
  assert.deepEqual(objects(anqr, revision, "supersedesProfileRevision"), ["urn:anqr:profile-revision:1"]);
  // Revision 1 declared that ANQR exists and nothing more. Revision 2 must not
  // have reached back and given it capabilities it never claimed.
  assert.equal(objects(anqr, "urn:anqr:profile-revision:1", "declaresCapability").length, 0);
});

test("every UI surface has an owner or an explicit disposition", () => {
  const surfaces = subjectsOfType(anqr, "urn:usf:type:ProductUiSurface");
  assert.ok(surfaces.length > 0);
  for (const surface of surfaces) {
    const disposition = objects(anqr, surface, "productScopeDisposition")[0] ?? "";
    const owners = objects(anqr, surface, "suppliedByCapability");
    assert.ok(disposition.length > 0, `${surface} must carry a disposition`);
    if (disposition.endsWith(":current")) {
      assert.ok(owners.length > 0, `${surface} is claimed and must name the capabilities it realises`);
    } else {
      assert.equal(owners.length, 0, `${surface} is not claimed and must not name an owning capability`);
    }
  }
});

test("every UI requirement the foundation declared profile-supplied is answered", () => {
  const policy = "urn:usf:core-surface-policy:v1:1";
  const kinds = new Set(objects(core, policy, "appliesToFacetKind"));
  const supplied = core.quads
    .filter((quad) => quad.predicate === `${P}facetKind` && kinds.has(quad.object))
    .map((quad) => quad.subject)
    .filter((facet) => objects(core, facet, "facetApplicability")[0] === "APPLICABLE");
  assert.ok(supplied.length > 0, "the foundation must have passed at least one UI requirement to a profile");
  const answered = new Set(subjectsOfType(anqr, "urn:usf:type:ProfileUiSupply")
    .flatMap((entry) => objects(anqr, entry, "coversSubject")));
  for (const facet of supplied) {
    assert.ok(answered.has(facet), `${facet} was passed to a profile and this profile must answer it`);
  }
});

test("an opportunity can never be read as claimed scope", () => {
  const opportunities = subjectsOfType(anqr, "urn:usf:type:ProductOpportunity");
  assert.ok(opportunities.length > 0);
  for (const opportunity of opportunities) {
    assert.deepEqual(objects(anqr, opportunity, "productScopeDisposition"),
      ["urn:usf:product-scope-disposition:reserved"],
      `${opportunity} must be reserved, so recording it authorises nothing`);
    assert.ok(objects(anqr, opportunity, "opportunityValue").length > 0);
  }
  // An opportunity is never itself a capability, so it can never be selected.
  const capabilities = new Set(subjectsOfType(anqr, "urn:usf:type:DeliveryCapability"));
  assert.equal(opportunities.filter((iri) => capabilities.has(iri)).length, 0);
});

test("the excluded concerns stay excluded", () => {
  const exclusions = subjectsOfType(anqr, "urn:usf:type:ProductExclusion");
  const concerns = exclusions.flatMap((iri) => objects(anqr, iri, "excludedConcern")).join(" ").toLowerCase();
  for (const term of ["reed-solomon", "mask", "placement", "routing", "scheduling", "worktree"]) {
    assert.ok(concerns.includes(term), `${term} must be explicitly excluded rather than merely absent`);
  }
  for (const exclusion of exclusions) {
    assert.equal(objects(anqr, exclusion, "exclusionReason").length, 1,
      `${exclusion} must say why, so a later reader cannot mistake it for an oversight`);
  }
  // Nothing excluded may also be declared as a capability.
  const names = new Set(subjectsOfType(anqr, "urn:usf:type:DeliveryCapability")
    .map((iri) => objects(anqr, iri, "canonicalName")[0] ?? ""));
  for (const term of ["reedsolomon", "maskscoring", "providerrouting", "workerscheduling"]) {
    assert.ok(!names.has(term));
  }
});
