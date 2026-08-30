import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { canonize } from "rdf-canonize";
import { loadSemanticGraph, type GraphManifestV2 } from "../../../src/graph/index.ts";
import { canonicalNQuads, sha256 } from "../../../src/graph/nquads.ts";
import {
  RepositorySemanticStore,
  SemanticStoreError,
  semanticReasonCodes,
} from "../../../src/semantic/index.ts";

const root = resolve(import.meta.dirname, "../../..");
const fixture = (name: string): string => `tests/fixtures/semantic/${name}`;

async function open(name = "manifest.json", maxQueryResults = 10): Promise<RepositorySemanticStore> {
  return RepositorySemanticStore.open({
    repositoryRoot: root,
    manifestPath: fixture(name),
    limits: { maxQueryResults, maxShaclResults: 10 },
  });
}

async function openAt(repositoryRoot: string, manifestPath = "graph/manifest.json", limits: Parameters<typeof RepositorySemanticStore.open>[0]["limits"] = {}): Promise<RepositorySemanticStore> {
  return RepositorySemanticStore.open({ repositoryRoot, manifestPath, limits });
}

function strictManifest(sourcePath: string, graph = "urn:test:graph:strict"): GraphManifestV2 {
  return {
    schema: "urn:usf:graph-manifest:2",
    version: 2,
    imports: [],
    sources: [{ path: sourcePath, format: "application/n-quads", graph, role: "data", validationProfile: "bootstrap-nquads-v1" }],
  };
}

function reason(error: unknown): string | undefined {
  return error instanceof SemanticStoreError ? error.reasonCode : undefined;
}

test("the semantic store is an immutable exact projection of graph-manifest v2 identity", async () => {
  const original = await open();
  const reordered = await open("manifest-reordered.json");
  const loaded = loadSemanticGraph(root, fixture("manifest.json"));
  const snapshot = original.snapshot();

  assert.deepEqual(snapshot.graphNames, ["urn:test:graph:data", "urn:test:graph:shapes"]);
  assert.equal(snapshot.quadCount, 10);
  assert.equal(snapshot.semanticDigest, loaded.semanticDigest);
  assert.equal(snapshot.canonicalNQuads, canonicalNQuads(loaded.quads));
  assert.deepEqual(snapshot.graphDigests, loaded.graphDigests);
  assert.deepEqual(snapshot.sourceDigests, loaded.sourceDigests);
  assert.equal(snapshot.sourceDigests[fixture("data.ttl")], sha256(readFileSync(resolve(root, fixture("data.ttl")))));
  assert.equal(snapshot.semanticDigest, reordered.snapshot().semanticDigest);
  assert.equal(snapshot.canonicalNQuads, reordered.snapshot().canonicalNQuads);
  assert.deepEqual(snapshot.graphDigests, reordered.snapshot().graphDigests);
  assert.doesNotMatch(snapshot.canonicalNQuads, /_:/u);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.graphNames), true);
  assert.equal(Object.isFrozen(snapshot.graphDigests), true);
  assert.equal(Object.isFrozen(snapshot.sourceDigests), true);
});

test("semantic identity normalizes accepted RDF lexical forms while source identity remains byte-exact", async (context) => {
  const temporaryParent = resolve(root, ".usf/tmp");
  mkdirSync(temporaryParent, { recursive: true, mode: 0o700 });
  const temporaryRoot = mkdtempSync(resolve(temporaryParent, "semantic-identity-"));
  context.after(() => rmSync(temporaryRoot, { recursive: true, force: true }));
  mkdirSync(resolve(temporaryRoot, "graph"));
  const manifest = strictManifest("graph/source.nq");
  writeFileSync(resolve(temporaryRoot, "graph/manifest.json"), `${JSON.stringify(manifest)}\n`, { mode: 0o600 });
  const sourcePath = resolve(temporaryRoot, "graph/source.nq");
  const line = (literal: string, ending: string): string => `<urn:test:s> <urn:test:p> "${literal}" <urn:test:graph:strict> .${ending}`;

  const rawSource = line("raw\ttab", "\r\n");
  const escapedSource = line("raw\\ttab", "\n");
  writeFileSync(sourcePath, rawSource, { mode: 0o600 });
  const raw = loadSemanticGraph(temporaryRoot);
  const rawSnapshot = (await openAt(temporaryRoot)).snapshot();

  writeFileSync(sourcePath, escapedSource, { mode: 0o600 });
  const escaped = loadSemanticGraph(temporaryRoot);
  const escapedSnapshot = (await openAt(temporaryRoot)).snapshot();

  assert.equal(raw.semanticDigest, escaped.semanticDigest);
  assert.deepEqual(raw.graphDigests, escaped.graphDigests);
  assert.notDeepEqual(raw.sourceDigests, escaped.sourceDigests);
  assert.equal(rawSnapshot.canonicalNQuads, escapedSnapshot.canonicalNQuads);
  assert.match(rawSnapshot.canonicalNQuads, /raw\\ttab/u);
  for (const lexicalSource of [rawSource, escapedSource]) {
    assert.equal(rawSnapshot.canonicalNQuads, await canonize(lexicalSource, {
      algorithm: "RDFC-1.0",
      inputFormat: "application/n-quads",
      maxWorkFactor: 1,
      signal: AbortSignal.timeout(1_000),
    }));
  }

  writeFileSync(sourcePath, line("café", "\n"), { mode: 0o600 });
  const unicode = loadSemanticGraph(temporaryRoot);
  writeFileSync(sourcePath, line("caf\\u00E9", "\n"), { mode: 0o600 });
  const escapedUnicode = loadSemanticGraph(temporaryRoot);
  assert.equal(unicode.semanticDigest, escapedUnicode.semanticDigest);
  assert.notDeepEqual(unicode.sourceDigests, escapedUnicode.sourceDigests);

  writeFileSync(sourcePath, `${line("raw\ttab", "\n")}${line("raw\\ttab", "\n")}`, { mode: 0o600 });
  await assert.rejects(openAt(temporaryRoot), (error) => reason(error) === semanticReasonCodes.SOURCE_PARSE_FAILED, "semantic duplicates expressed with different lexical escapes fail closed");

  writeFileSync(resolve(temporaryRoot, "graph/manifest.json"), `${JSON.stringify({ ...manifest, sources: [] })}\n`, { mode: 0o600 });
  const empty = loadSemanticGraph(temporaryRoot);
  const emptySnapshot = (await openAt(temporaryRoot)).snapshot();
  assert.equal(empty.semanticDigest, sha256(""));
  assert.equal(emptySnapshot.canonicalNQuads, "");
  assert.deepEqual(emptySnapshot.graphNames, []);
});

test("manifest source path traversal is refused before local file access", async () => {
  await assert.rejects(
    open("manifest-path-defect.json"),
    (error) => reason(error) === semanticReasonCodes.SOURCE_PATH_REFUSED,
  );
});

test("local Oxigraph accepts bounded SELECT, ASK and CONSTRUCT", async () => {
  const store = await open();
  const identityBefore = JSON.stringify(store.snapshot());
  const select = await store.query(`
    SELECT ?service ?name WHERE {
      GRAPH <urn:test:graph:data> {
        ?service a <urn:test:Service>; <urn:test:name> ?name.
      }
    }
    ORDER BY ?service
    LIMIT 2
  `, { maxResults: 2 });
  assert.equal(select.type, "select");
  if (select.type === "select") {
    assert.equal(select.rows.length, 1);
    assert.equal(select.rows[0]?.service?.value, "urn:test:service-alpha");
    assert.equal(select.rows[0]?.name?.value, "Alpha");
  }

  const ask = await store.query("ASK { GRAPH <urn:test:graph:data> { <urn:test:service-alpha> a <urn:test:Service> } }");
  assert.deepEqual(ask, { type: "ask", value: true });

  const construct = await store.query(`
    CONSTRUCT { ?service <urn:test:copied-name> ?name }
    WHERE { GRAPH <urn:test:graph:data> { ?service <urn:test:name> ?name } }
    LIMIT 2
  `, { maxResults: 2 });
  assert.equal(construct.type, "construct");
  if (construct.type === "construct") {
    assert.equal(construct.quadCount, 1);
    assert.match(construct.canonicalNQuads, /urn:test:copied-name/u);
  }
  assert.equal(JSON.stringify(store.snapshot()), identityBefore);
});

test("updates, SERVICE, remote graph loading, unbounded and over-limit results are planted refusals", async () => {
  const store = await open();
  const defects: ReadonlyArray<readonly [string, string]> = [
    ["INSERT DATA { <urn:x> <urn:y> <urn:z> }", semanticReasonCodes.QUERY_UPDATE_REFUSED],
    ["SELECT ?s WHERE { SERVICE <https://remote.invalid/sparql> { ?s ?p ?o } } LIMIT 1", semanticReasonCodes.QUERY_SERVICE_REFUSED],
    ["SELECT ?s FROM <https://remote.invalid/graph> WHERE { ?s ?p ?o } LIMIT 1", semanticReasonCodes.QUERY_REMOTE_GRAPH_REFUSED],
    ["SELECT ?s WHERE { GRAPH <urn:test:graph:data> { ?s ?p ?o } }", semanticReasonCodes.QUERY_UNBOUNDED_REFUSED],
    ["SELECT ?s WHERE { GRAPH <urn:test:graph:data> { ?s ?p ?o } } LIMIT 3", semanticReasonCodes.QUERY_LIMIT_REFUSED],
  ];
  for (const [sparql, expected] of defects) {
    await assert.rejects(store.query(sparql, { maxResults: 2 }), (error) => reason(error) === expected);
  }
  assert.equal(store.snapshot().quadCount, 10, "refused queries cannot mutate the store");
});

test("SHACL validation conforms for valid data and returns a bounded invalid report", async () => {
  const valid = await open();
  const identityBefore = JSON.stringify(valid.snapshot());
  const validReport = await valid.validateShacl({
    shapeGraphs: ["urn:test:graph:shapes"],
    dataGraphs: ["urn:test:graph:data"],
    maxResults: 1,
  });
  assert.deepEqual(validReport, { conforms: true, results: [], resultCount: 0, truncated: false });
  assert.equal(JSON.stringify(valid.snapshot()), identityBefore);

  const invalid = await open("manifest-invalid-data.json");
  const invalidReport = await invalid.validateShacl({
    shapeGraphs: ["urn:test:graph:shapes"],
    dataGraphs: ["urn:test:graph:data"],
    maxResults: 1,
  });
  assert.equal(invalidReport.conforms, false);
  assert.equal(invalidReport.results.length, 1);
  assert.equal(invalidReport.results[0]?.focusNode.value, "urn:test:service-invalid");
  assert.equal(invalidReport.results[0]?.sourceConstraintComponent.value, "http://www.w3.org/ns/shacl#HasValueConstraintComponent");
  assert.equal(invalidReport.truncated, false);
});

test("v1, Turtle, blank nodes, RDF-star, graph mismatch and invalid UTF-8 fail closed", async (context) => {
  const temporaryParent = resolve(root, ".usf/tmp");
  mkdirSync(temporaryParent, { recursive: true, mode: 0o700 });
  const temporaryRoot = mkdtempSync(resolve(temporaryParent, "semantic-strict-"));
  context.after(() => rmSync(temporaryRoot, { recursive: true, force: true }));
  mkdirSync(resolve(temporaryRoot, "graph"));
  const manifestPath = resolve(temporaryRoot, "graph/manifest.json");
  const sourcePath = resolve(temporaryRoot, "graph/source.nq");
  const writeManifest = (value: unknown): void => writeFileSync(manifestPath, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  const strict = strictManifest("graph/source.nq");

  writeManifest({ schema: "urn:usf:semantic-store-manifest:1", version: 1, sources: strict.sources });
  await assert.rejects(openAt(temporaryRoot), (error) => reason(error) === semanticReasonCodes.MANIFEST_INVALID);

  writeManifest(strict);
  const invalidSources: ReadonlyArray<readonly [string | Buffer, string]> = [
    ["@prefix ex: <urn:test:> .\n", "Turtle"],
    ["_:blank <urn:test:p> <urn:test:o> <urn:test:graph:strict> .\n", "blank node"],
    ["<< <urn:test:s> <urn:test:p> <urn:test:o> >> <urn:test:p> <urn:test:o> <urn:test:graph:strict> .\n", "RDF-star"],
    ["<urn:test:s> <urn:test:p> <urn:test:o> <urn:test:graph:other> .\n", "graph mismatch"],
    ["<urn:test:s> <urn:test:p> \"\\uD800\" <urn:test:graph:strict> .\n", "invalid Unicode scalar"],
    [Buffer.from([0xff]), "invalid UTF-8"],
  ];
  for (const [content, label] of invalidSources) {
    writeFileSync(sourcePath, content, { mode: 0o600 });
    await assert.rejects(openAt(temporaryRoot), (error) => reason(error) === semanticReasonCodes.SOURCE_PARSE_FAILED, label);
  }
});

test("all configured ingestion limits and source file containment fail closed", async (context) => {
  const table: ReadonlyArray<readonly [Parameters<typeof openAt>[2], string]> = [
    [{ maxManifestBytes: 1 }, semanticReasonCodes.MANIFEST_INVALID],
    [{ maxTotalManifestBytes: 1 }, semanticReasonCodes.MANIFEST_INVALID],
    [{ maxSourceCount: 1 }, semanticReasonCodes.MANIFEST_INVALID],
    [{ maxSourceBytes: 1 }, semanticReasonCodes.SOURCE_TOO_LARGE],
    [{ maxTotalSourceBytes: 1 }, semanticReasonCodes.SOURCE_TOO_LARGE],
    [{ maxDatasetQuads: 1 }, semanticReasonCodes.DATASET_TOO_LARGE],
    [{ maxManifestDepth: 0 }, semanticReasonCodes.STORE_LIMIT_INVALID],
    [{ maxManifestCount: Number.MAX_SAFE_INTEGER + 1 }, semanticReasonCodes.STORE_LIMIT_INVALID],
  ];
  for (const [limits, expected] of table) {
    await assert.rejects(openAt(root, fixture("manifest.json"), limits), (error) => reason(error) === expected);
  }

  const temporaryParent = resolve(root, ".usf/tmp");
  mkdirSync(temporaryParent, { recursive: true, mode: 0o700 });
  const temporaryRoot = mkdtempSync(resolve(temporaryParent, "semantic-path-"));
  context.after(() => rmSync(temporaryRoot, { recursive: true, force: true }));
  mkdirSync(resolve(temporaryRoot, "graph"));
  const target = resolve(temporaryRoot, "graph/target.nq");
  writeFileSync(target, "<urn:test:s> <urn:test:p> <urn:test:o> <urn:test:graph:strict> .\n", { mode: 0o600 });
  symlinkSync("target.nq", resolve(temporaryRoot, "graph/link.nq"));
  writeFileSync(resolve(temporaryRoot, "graph/manifest.json"), `${JSON.stringify(strictManifest("graph/link.nq"))}\n`, { mode: 0o600 });
  await assert.rejects(openAt(temporaryRoot), (error) => reason(error) === semanticReasonCodes.SOURCE_PATH_REFUSED);

  mkdirSync(resolve(temporaryRoot, "graph/not-a-file"));
  writeFileSync(resolve(temporaryRoot, "graph/manifest.json"), `${JSON.stringify(strictManifest("graph/not-a-file"))}\n`, { mode: 0o600 });
  await assert.rejects(openAt(temporaryRoot), (error) => reason(error) === semanticReasonCodes.SOURCE_UNREADABLE);
});

test("SHACL graph and report limits are refused before validation", async () => {
  const store = await open();
  await assert.rejects(
    store.validateShacl({ shapeGraphs: ["urn:test:graph:absent"], dataGraphs: ["urn:test:graph:data"] }),
    (error) => reason(error) === semanticReasonCodes.SHACL_GRAPH_UNKNOWN,
  );
  await assert.rejects(
    store.validateShacl({ shapeGraphs: ["urn:test:graph:shapes"], dataGraphs: ["urn:test:graph:data"], maxResults: 11 }),
    (error) => reason(error) === semanticReasonCodes.SHACL_LIMIT_REFUSED,
  );
});
