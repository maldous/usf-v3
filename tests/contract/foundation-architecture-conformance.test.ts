import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseStrictNQuads, type Quad } from "../../src/graph/nquads.ts";
import { readArchitectureDeclaration, declarationDigest } from "../../src/architecture/declaration.ts";
import { observeArchitecture } from "../../src/architecture/observe.ts";
import { composeReleaseAssurance, conformanceDispositions, evaluateArchitectureConformance } from "../../src/architecture/conformance.ts";

/**
 * The corpus lane.
 *
 * The graph-selected validation for this work is confined to a candidate
 * workspace, which holds the declared closure and nothing else. Every
 * requirement in the foundation architecture assurance set is declared at
 * corpus scope precisely because it is not observable there: asserting one
 * inside the candidate would either fail on an absence the confinement caused
 * or pass over a tree the check never read. This is where the corpus claim is
 * made, against the whole repository.
 */

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const architecture = "urn:usf:architecture:1";
const assuranceSet = "urn:usf:assurance-set:foundation-architecture:1";
const releaseClaim = "urn:usf:release-assurance-claim:foundation:1";
const corpusScope = "urn:usf:assurance-scope:corpus";

/**
 * Enumerated recursively and deliberately: a flat readdir over the graph tree
 * once validated fourteen of twenty-one sources and had never seen the product
 * overlay. Fixtures are excluded because synthetic test input in its own
 * namespace is not corpus authority.
 */
function graphSources(): string[] {
  const found: string[] = [];
  const walk = (absolute: string): void => {
    for (const entry of readdirSync(absolute, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const child = join(absolute, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "fixtures") continue;
        walk(child);
      } else if (entry.name.endsWith(".nq")) found.push(relative(repositoryRoot, child).split(sep).join("/"));
    }
  };
  walk(join(repositoryRoot, "graph"));
  return found;
}

function corpusQuads(): Quad[] {
  const quads: Quad[] = [];
  for (const source of graphSources()) {
    const text = readFileSync(join(repositoryRoot, source), "utf8");
    const firstLine = text.slice(0, text.indexOf("\n"));
    const graph = /<([^<>]+)> \.$/u.exec(firstLine)?.[1];
    assert.ok(graph !== undefined, `${source} does not end its first line with a named graph`);
    quads.push(...parseStrictNQuads(text, graph));
  }
  return quads;
}

const declaration = readArchitectureDeclaration(corpusQuads(), architecture);
const observation = observeArchitecture({ repositoryRoot, declaration, scope: corpusScope });
const verdict = evaluateArchitectureConformance({ declaration, observation, assuranceSet });

test("the foundation declares an architecture with roots, a population and classifications", () => {
  assert.equal(declaration.architecture, architecture);
  assert.ok(declaration.layers.length >= 7, "every declared layer resolves");
  assert.ok(declaration.components.length >= 12, "every declared component resolves");
  assert.ok(declaration.entryPoints.length >= 5, "every declared entry point resolves");
  assert.ok(declaration.population !== null, "the population is declared");
  assert.deepEqual(declaration.population?.roots, ["recipes/", "src/"]);
  assert.ok(declaration.entryPoints.some((each) => each.surface.endsWith("build-time")), "a build-time surface is declared");
  assert.ok(declaration.classifications.length >= 8, "every admitted classification resolves");
  assert.equal(declaration.assuranceSets.find((each) => each.iri === assuranceSet)?.members.length, declaration.requirements.length);
});

test("the whole declared population is classified, with nothing unaccounted", () => {
  const counted = Object.values(verdict.denominator.byClassification).reduce((total, each) => total + each, 0);
  assert.deepEqual(verdict.denominator.unaccounted, []);
  assert.equal(counted, verdict.denominator.population);
  assert.equal(verdict.classifications.length, verdict.denominator.population);
});

test("no implementation unit is an unexplained orphan", () => {
  assert.deepEqual(verdict.denominator.nonConforming, []);
});

test("every requirement in the assurance set is decided and holds", () => {
  const undecided = verdict.requirements.filter((each) => each.disposition !== conformanceDispositions.conforming);
  assert.deepEqual(undecided.map((each) => `${each.canonicalName}: ${each.disposition} ${each.findings.join("; ")}${each.reason ?? ""}`), []);
  assert.equal(verdict.disposition, conformanceDispositions.conforming);
  assert.ok(verdict.requirements.length >= 9);
});

test("the release claim composes the assurance set and is satisfied", () => {
  const composed = composeReleaseAssurance(declaration, releaseClaim, [verdict]);
  assert.deepEqual(composed.missing, []);
  assert.deepEqual(composed.failed, []);
  assert.deepEqual(composed.satisfied, [assuranceSet]);
  assert.equal(composed.disposition, conformanceDispositions.conforming);
});

test("a release claim with no verdict for a required set is missing evidence, not satisfied", () => {
  const composed = composeReleaseAssurance(declaration, releaseClaim, []);
  assert.deepEqual(composed.missing, [assuranceSet]);
  assert.deepEqual(composed.failed, []);
  assert.equal(composed.disposition, conformanceDispositions.evidenceMissing);
});

test("an observation of a different tree is rejected as stale rather than believed", () => {
  const otherTree = { ...observation, populationDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000" };
  const stale = evaluateArchitectureConformance({
    declaration,
    observation: otherTree,
    assuranceSet,
    expectedPopulationDigest: observation.populationDigest,
  });
  assert.equal(stale.disposition, conformanceDispositions.evidenceStale);
  assert.ok(stale.requirements.every((each) => each.disposition === conformanceDispositions.evidenceStale));
  const composed = composeReleaseAssurance(declaration, releaseClaim, [stale]);
  assert.equal(composed.disposition, conformanceDispositions.failed);
});

test("an observation taken against a different declaration is rejected as stale", () => {
  const moved = { ...declaration, layers: [] };
  const stale = evaluateArchitectureConformance({ declaration: moved, observation, assuranceSet });
  assert.notEqual(declarationDigest(moved), observation.declarationDigest);
  assert.equal(stale.disposition, conformanceDispositions.evidenceStale);
});

test("the observer is replaceable: the same facts under another producer give the same verdict", () => {
  const substituted = { ...observation, producer: "urn:usf:architecture-observer:substitute:1" };
  const other = evaluateArchitectureConformance({ declaration, observation: substituted, assuranceSet });
  assert.equal(other.disposition, verdict.disposition);
  assert.deepEqual(other.requirements.map((each) => [each.requirement, each.disposition]), verdict.requirements.map((each) => [each.requirement, each.disposition]));
  assert.deepEqual(other.denominator, verdict.denominator);
  assert.notEqual(other.producer, verdict.producer);
});

test("the measured denominator is reported by classification", () => {
  const named = Object.fromEntries(Object.entries(verdict.denominator.byClassification)
    .map(([iri, count]) => [iri.slice("urn:usf:implementation-classification:".length), count]));
  assert.equal(named["unexplained-orphan"], 0);
  assert.ok((named["runtime-reachable"] ?? 0) > 0);
  assert.ok((named["product-declared"] ?? 0) > 0);
  assert.ok((named["assurance-tooling"] ?? 0) > 0);
  assert.equal(verdict.denominator.deferred.length, named["product-declared"]);
  // Reported rather than only asserted, because the numbers are the deliverable.
  console.log(JSON.stringify({ population: verdict.denominator.population, byClassification: named }));
});

test("every declared adversarial verification names a target that exists", () => {
  const known = new Set<string>([
    ...declaration.requirements.map((each) => each.iri),
    ...declaration.assuranceSets.map((each) => each.iri),
    ...declaration.releaseClaims.map((each) => each.iri),
  ]);
  assert.ok(declaration.adversarialVerifications.length >= 12);
  for (const each of declaration.adversarialVerifications) {
    assert.ok(each.target !== null && known.has(each.target), `${each.iri} targets ${each.target}`);
    assert.ok((each.plantedViolation ?? "").length > 0 && (each.expectedDetection ?? "").length > 0);
  }
});

test("the enforcement binding names modules that exist and are in the population", () => {
  const modules = declaration.enforcementBindings.flatMap((each) => each.modules);
  assert.ok(modules.length > 0);
  for (const module of modules) assert.ok(observation.population.includes(module), `${module} is a population member`);
});
