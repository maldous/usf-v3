// Derive ANQR's architecture enforcement rules from the USF semantic graph.
//
// The graph is authority. This script projects it into the form the product
// repository's checker consumes, so ANQR can enforce its architecture without
// importing USF or depending on this checkout at run time. The projection is
// never the truth: a drift check compares a fresh derivation against the
// committed output, and the graph wins.
//
//   node scripts/derive-anqr-architecture-rules.mjs [output-path]
//
// With no argument it writes the derivation to stdout, which is what the drift
// check uses so it never has to touch the product tree.

import { fileURLToPath } from "node:url";
import { loadSemanticGraph, objectValues } from "../src/graph/index.ts";
const P = "urn:usf:predicate:";
// Derived from this script's own location, never a machine path: the guard
// correctly refused a hardcoded root, and a hardcoded root would also make the
// derivation unusable from any other checkout.
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const g = loadSemanticGraph(repositoryRoot, "graph/products/anqr/semantic-build-manifest.json");
const vals = (s, p) => objectValues(g, s, P + p);
const one = (s, p) => { const v = vals(s, p); return v.length ? v[0] : null; };
const typed = (t) => [...new Set(g.quads.filter(q => q.predicate === P + "type" && q.object === t).map(q => q.subject))].sort();
const local = (iri) => iri.split(":").pop();

const layers = typed("urn:usf:type:ArchitecturalLayer").map(l => ({
  name: one(l, "canonicalName"), ordinal: Number(one(l, "layerOrdinal")), iri: l,
})).sort((a, b) => a.ordinal - b.ordinal);

const components = typed("urn:usf:type:ArchitecturalComponent").map(c => ({
  name: one(c, "canonicalName"), layer: local(one(c, "inLayer")),
  location: one(c, "componentLocation"), status: one(c, "specificationStatus"), iri: c,
}));

const ports = typed("urn:usf:type:ArchitecturalPort").map(p => ({
  name: one(p, "canonicalName"), direction: local(one(p, "portDirection")),
  contractLocation: one(p, "portContractLocation"),
  servedBy: vals(p, "servedByAdapter").map(local), iri: p,
}));

const adapters = typed("urn:usf:type:ArchitecturalAdapter").map(a => ({
  name: one(a, "canonicalName"), layer: local(one(a, "inLayer")),
  implementsPort: vals(a, "adapterImplementsPort").map(i => one(i, "canonicalName")), iri: a,
}));

const dependencyRules = typed("urn:usf:type:DependencyDirectionRule").map(r => ({
  kind: local(one(r, "dependencyRuleKind")),
  from: local(one(r, "dependencyFrom")), to: local(one(r, "dependencyTo")),
  reason: one(r, "dependencyRuleReason"), iri: r,
}));

const isolation = typed("urn:usf:type:FrameworkIsolationRule").map(r => ({
  layers: vals(r, "frameworkIsolatedLayer").map(local),
  technologies: vals(r, "isolatedFromTechnology").sort(),
  reason: one(r, "dependencyRuleReason"), iri: r,
}));

const cyclePolicy = typed("urn:usf:type:CircularDependencyPolicy").map(r => ({
  scope: one(r, "cyclePolicyScope"), permitted: one(r, "cyclesPermitted") === "true", iri: r,
}));

const scopeRules = typed("urn:usf:type:DependencyScopeRule").map(r => ({
  runtime: one(r, "runtimeDependencyRule"), development: one(r, "developmentDependencyRule"), iri: r,
}));

const generated = typed("urn:usf:type:GeneratedCodeBoundary").map(r => ({
  location: one(r, "generatedCodeLocation"), consumerRule: one(r, "generatedCodeConsumerRule"), iri: r,
}));

const testBoundaries = typed("urn:usf:type:TestBoundaryRule").map(r => ({
  testClass: one(r, "testClass"), mayImport: one(r, "testMayImport"), mayNotImport: one(r, "testMayNotImport"), iri: r,
}));

const moduleBoundaries = typed("urn:usf:type:ModuleBoundaryRule").map(r => ({
  name: one(r, "canonicalName"),
  scope: vals(r, "boundaryScope").filter(v => !v.startsWith("urn:")),
  forbids: vals(r, "boundaryForbids"),
  reason: one(r, "dependencyRuleReason"), iri: r,
}));

const facets = typed("urn:usf:type:DeliveryFacet")
  .filter(f => one(f, "facetKind") === "urn:usf:facet-kind:architecture")
  .map(f => ({
    name: one(f, "canonicalName"), iri: f,
    statement: one(f, "facetStatement"), expected: one(f, "expectedResult"),
    verificationClass: local(one(f, "verificationClass")),
    severity: local(one(f, "requirementSeverity")),
    stage: local(one(f, "runsAtStage")),
    scope: one(f, "requirementScope"),
  }));

const payload = {
  authority: {
    architecture: "urn:anqr:architecture:1",
    foundationRevision: "urn:usf:foundation-revision:v3:1",
    profileRevision: "urn:anqr:profile-revision:2",
    manifest: "graph/products/anqr/semantic-build-manifest.json",
  },
  layers, components, ports, adapters, dependencyRules, isolation,
  cyclePolicy, scopeRules, generated, testBoundaries, moduleBoundaries, facets,
};
const out = process.argv[2];
const body = `${JSON.stringify(payload, null, 2)}\n`;
if (out) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(out, body);
  console.log("wrote", out, body.length, "bytes");
} else process.stdout.write(body);
