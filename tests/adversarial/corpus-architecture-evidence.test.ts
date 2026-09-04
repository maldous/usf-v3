import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import type { SemanticGraph } from "../../src/graph/index.ts";
import { canonicalQuadLine, type Quad } from "../../src/graph/nquads.ts";
import {
  corpusObservationDirectory, declaredCorpusProcedures, digestCorpus, loadCorpusObservations,
} from "../../src/providers/architecture-observation.ts";
import { allEvidenceClasses, evaluateFacets, type EvidenceIndex } from "../../src/providers/facet-evaluation.ts";

/**
 * Rebinding a requirement to the scope that can observe it must not make the
 * requirement easier to satisfy. Every case below is an attempt to obtain a
 * satisfied verdict for a corpus-scoped architecture requirement without a
 * procedure having actually observed the corpus and found it holds.
 *
 * The prior binding failed in the honest direction -- it satisfied nothing --
 * so the only acceptable outcome for this change is that it still satisfies
 * nothing except a real observation of the real corpus.
 */

const G = "urn:usf:graph:v3-delivery";
const P = "urn:usf:predicate:";
const CORPUS_FACET = "urn:anqr:delivery-facet:architecturenodependencycycles";
const OTHER_CORPUS_FACET = "urn:anqr:delivery-facet:architectureimportsresolve";
const MODULE_FACET = "urn:anqr:delivery-facet:architecturesurfaceparity";
const PROCEDURE = "urn:anqr:corpus-observation:architecture-static";

function quad(subject: string, predicate: string, object: string, objectKind: "iri" | "literal" = "literal"): Quad {
  const built = { subject, predicate, object, objectKind, graph: G, canonical: "" };
  built.canonical = canonicalQuadLine(built);
  return built;
}

function graphOf(quads: readonly Quad[]): SemanticGraph {
  return Object.freeze({ quads: Object.freeze([...quads]) }) as unknown as SemanticGraph;
}

function facetQuads(iri: string, name: string, evidenceClass: string, scope: string): Quad[] {
  const contract = "urn:anqr:architecture-contract:subject";
  return [
    quad(iri, `${P}type`, "urn:usf:type:DeliveryFacet", "iri"),
    quad(iri, `${P}canonicalName`, name),
    quad(iri, `${P}admissibleEvidenceClass`, evidenceClass),
    quad(iri, `${P}assuranceScope`, scope, "iri"),
    quad(iri, `${P}facetApplicability`, "APPLICABLE"),
    quad(iri, `${P}facetStatement`, `${name} must hold`),
    quad(iri, `${P}facetKind`, "urn:usf:facet-kind:architecture", "iri"),
    quad(contract, `${P}declaresFacet`, iri, "iri"),
    quad(contract, `${P}definesCompletionFor`, "urn:anqr:delivery-capability:subject", "iri"),
  ];
}

const subjectGraph = graphOf([
  ...facetQuads(CORPUS_FACET, "architecturenodependencycycles", "structural-observation", "urn:usf:assurance-scope:corpus"),
  ...facetQuads(OTHER_CORPUS_FACET, "architectureimportsresolve", "structural-observation", "urn:usf:assurance-scope:corpus"),
  ...facetQuads(MODULE_FACET, "architecturesurfaceparity", "implementation-conformance", "urn:usf:assurance-scope:implementation-unit"),
]);

function evidence(over: Partial<EvidenceIndex> = {}): EvidenceIndex {
  return Object.freeze({
    realizedArtefacts: new Map(),
    runtimeComposed: false,
    validatorOutcomes: Object.freeze([]),
    proofOutcomes: Object.freeze([]),
    conformanceOutcomes: new Map(),
    structuralObservations: new Map(),
    suppliedEvidenceClasses: allEvidenceClasses,
    ...over,
  });
}

function stateOf(index: EvidenceIndex, facet = CORPUS_FACET): string {
  return evaluateFacets(subjectGraph, index).find((verdict) => verdict.facet === facet)!.state;
}

function observed(over: Partial<{
  facet: string; executed: boolean; passed: boolean; stale: boolean; detail: string | null;
}> = {}): EvidenceIndex {
  const entry = {
    facet: over.facet ?? CORPUS_FACET,
    procedure: PROCEDURE,
    executed: over.executed ?? true,
    passed: over.passed ?? true,
    stale: over.stale ?? false,
    detail: over.detail ?? null,
    evidence: `${PROCEDURE}@abc`,
  };
  return evidence({ structuralObservations: new Map([[entry.facet, Object.freeze(entry)]]) });
}

test("a corpus requirement with no observation at all is blocked, never satisfied", () => {
  assert.equal(stateOf(evidence()), "BLOCKED");
});

test("a real observation of the real corpus is what satisfies it", () => {
  assert.equal(stateOf(observed()), "SATISFIED");
});

test("an observation that found the requirement violated is unsatisfied, not blocked away", () => {
  // Blocked would hide a real architecture failure behind "no evidence yet",
  // which is the softer and more dangerous of the two readings.
  assert.equal(stateOf(observed({ passed: false, detail: "cycle: a -> b -> a" })), "UNSATISFIED");
  const verdict = evaluateFacets(subjectGraph, observed({ passed: false, detail: "cycle: a -> b -> a" }))
    .find((entry) => entry.facet === CORPUS_FACET)!;
  assert.match(verdict.reason, /a -> b -> a/u);
});

test("a procedure that ran but did not decide the requirement satisfies nothing", () => {
  assert.equal(stateOf(observed({ executed: false })), "BLOCKED");
});

test("a procedure that ran but did not decide it cannot be rescued by claiming it passed", () => {
  // executed:false with passed:true is the shape a careless producer would
  // emit for "nothing to report". It must not read as satisfied.
  assert.equal(stateOf(observed({ executed: false, passed: true })), "BLOCKED");
});

test("an observation of a corpus that has since changed is stale, not satisfied", () => {
  assert.equal(stateOf(observed({ stale: true })), "STALE");
});

test("another requirement's observation cannot be borrowed to satisfy this one", () => {
  // The entry is keyed by facet, so a passing observation of import resolution
  // is invisible to the cycle requirement however real it is.
  const borrowed = observed({ facet: OTHER_CORPUS_FACET });
  assert.equal(stateOf(borrowed), "BLOCKED");
  assert.equal(stateOf(borrowed, OTHER_CORPUS_FACET), "SATISFIED");
});

test("a passing module conformance subtest cannot satisfy a corpus requirement", () => {
  // This is the mispairing the whole repair exists to correct, tried in
  // reverse: behavioural evidence offered for a structural requirement.
  const behavioural = evidence({
    conformanceOutcomes: new Map([[CORPUS_FACET, Object.freeze({
      executed: true, passed: true, stale: false, blocked: false,
      evidence: "tests/conformance/x.test.ts", detail: null,
    })]]),
  });
  assert.equal(stateOf(behavioural), "BLOCKED");
});

test("a corpus observation cannot satisfy a module-scoped behavioural requirement either", () => {
  // Scope decides admissible evidence in both directions, or it decides nothing.
  const structural = observed({ facet: MODULE_FACET });
  assert.equal(stateOf(structural, MODULE_FACET), "NOT_ASSESSED");
});

test("an unusable record satisfies nothing and does not overwrite a usable one", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "usf-corpus-observation-"));
  try {
    const directory = resolve(root, corpusObservationDirectory);
    await mkdir(directory, { recursive: true });
    const base = {
      schema: "urn:usf:corpus-architecture-observation:1", version: 1,
      procedure: PROCEDURE, sourceRepository: null,
      observationPath: "observe.test.ts", observationPathDigest: "",
      corpusRoots: [], corpusDigest: "sha256:none", corpusFileCount: 0,
      command: [], exitCode: 0, signal: null, reportedPassCount: 1, reportedFailCount: 0,
      nonClaims: [],
    };
    // A procedure that refused to run, reporting a pass it never observed.
    await writeFile(resolve(directory, "a.json"), JSON.stringify({
      ...base, confined: false, executed: false, refusal: "confinement unavailable",
      outcomes: [{ facet: CORPUS_FACET, facetName: "x", executed: true, passed: true, detail: null }],
    }));
    const loaded = await loadCorpusObservations(root);
    const entry = loaded.get(CORPUS_FACET)!;
    assert.equal(entry.executed, false);
    assert.equal(entry.passed, false);
    assert.equal(stateOf(evidence({ structuralObservations: loaded })), "BLOCKED");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a record whose corpus digest no longer matches the corpus is loaded as stale", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "usf-corpus-digest-"));
  try {
    await mkdir(resolve(root, "packages"), { recursive: true });
    await writeFile(resolve(root, "packages", "one.ts"), "export const one = 1;\n");
    await writeFile(resolve(root, "observe.test.ts"), "// procedure\n");
    const truthful = await digestCorpus(root, ["packages"]);
    const directory = resolve(root, corpusObservationDirectory);
    await mkdir(directory, { recursive: true });
    const record = {
      schema: "urn:usf:corpus-architecture-observation:1", version: 1,
      procedure: PROCEDURE, sourceRepository: null,
      observationPath: "observe.test.ts",
      observationPathDigest: (await digestCorpus(root, [])).digest,
      corpusRoots: ["packages"], corpusDigest: truthful.digest, corpusFileCount: truthful.fileCount,
      confined: true, command: [], executed: true, exitCode: 0, signal: null,
      reportedPassCount: 1, reportedFailCount: 0, refusal: null, nonClaims: [],
      outcomes: [{ facet: CORPUS_FACET, facetName: "x", executed: true, passed: true, detail: null }],
    };
    // The observation path digest is deliberately wrong above, so this proves
    // the procedure's own bytes are bound too, not only the corpus it read.
    await writeFile(resolve(directory, "a.json"), JSON.stringify(record));
    assert.equal((await loadCorpusObservations(root)).get(CORPUS_FACET)!.stale, true);

    // Bind the procedure honestly, and the same record is current.
    const { readFile } = await import("node:fs/promises");
    const { canonicalDigest } = await import("../../src/core/canonical.ts");
    await writeFile(resolve(directory, "a.json"), JSON.stringify({
      ...record, observationPathDigest: canonicalDigest(await readFile(resolve(root, "observe.test.ts"), "utf8")),
    }));
    assert.equal((await loadCorpusObservations(root)).get(CORPUS_FACET)!.stale, false);

    // Change one byte of the corpus and the standing observation retires.
    await writeFile(resolve(root, "packages", "one.ts"), "export const one = 2;\n");
    const afterChange = await loadCorpusObservations(root);
    assert.equal(afterChange.get(CORPUS_FACET)!.stale, true);
    assert.equal(stateOf(evidence({ structuralObservations: afterChange })), "STALE");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a procedure is discovered from the graph, and one naming no requirement decides nothing", () => {
  const declaredQuads = [
    quad(PROCEDURE, `${P}type`, "urn:usf:type:CorpusObservationProcedure", "iri"),
    quad(PROCEDURE, `${P}observationPath`, "tests/architecture/corpus-observation.test.ts"),
    quad(PROCEDURE, `${P}corpusRoot`, "packages"),
    quad(PROCEDURE, `${P}observesRepository`, "urn:anqr:repository:main", "iri"),
    quad(CORPUS_FACET, `${P}canonicalName`, "architecturenodependencycycles"),
    quad(CORPUS_FACET, `${P}observedByProcedure`, PROCEDURE, "iri"),
  ];
  const [found] = declaredCorpusProcedures(graphOf(declaredQuads));
  assert.equal(found?.procedure, PROCEDURE);
  assert.equal(found?.sourceRepository, "urn:anqr:repository:main");
  assert.deepEqual(found?.requirements.map((entry) => entry.facet), [CORPUS_FACET]);

  // No requirement binds itself to it, so there is nothing for it to decide
  // and it is not offered as a procedure at all.
  const unbound = declaredCorpusProcedures(graphOf(declaredQuads.filter((entry) =>
    entry.predicate !== `${P}observedByProcedure`)));
  assert.deepEqual(unbound, []);

  // A procedure that declares no corpus cannot bind an observation to anything.
  const rootless = declaredCorpusProcedures(graphOf(declaredQuads.filter((entry) =>
    entry.predicate !== `${P}corpusRoot`)));
  assert.deepEqual(rootless, []);
});

test("the corpus digest covers only the declared roots", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "usf-corpus-scope-"));
  try {
    await mkdir(resolve(root, "packages"), { recursive: true });
    await mkdir(resolve(root, "elsewhere"), { recursive: true });
    await writeFile(resolve(root, "packages", "one.ts"), "export const one = 1;\n");
    const before = await digestCorpus(root, ["packages"]);
    await writeFile(resolve(root, "elsewhere", "two.ts"), "export const two = 2;\n");
    const after = await digestCorpus(root, ["packages"]);
    // A requirement stated over packages/ is not retired by a change the
    // requirement does not reach.
    assert.equal(after.digest, before.digest);
    assert.equal(after.fileCount, 1);
    // ...and it is retired by one inside its declared extent.
    await writeFile(resolve(root, "packages", "three.ts"), "export const three = 3;\n");
    assert.notEqual((await digestCorpus(root, ["packages"])).digest, before.digest);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
