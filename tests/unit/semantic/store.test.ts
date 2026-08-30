import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
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

function reason(error: unknown): string | undefined {
  return error instanceof SemanticStoreError ? error.reasonCode : undefined;
}

test("manifest-selected local RDF is assigned to named graphs and has stable RDFC-1.0 identity", async () => {
  const original = await open();
  const reordered = await open("manifest-reordered.json");

  assert.deepEqual(original.snapshot().graphNames, ["urn:test:graph:data", "urn:test:graph:shapes"]);
  assert.equal(original.snapshot().quadCount, 11);
  assert.equal(original.snapshot().semanticDigest, reordered.snapshot().semanticDigest);
  assert.equal(original.snapshot().canonicalNQuads, reordered.snapshot().canonicalNQuads);
  assert.match(original.snapshot().canonicalNQuads, /_:c14n/u);
});

test("manifest source path traversal is refused before local file access", async () => {
  await assert.rejects(
    open("manifest-path-defect.json"),
    (error) => reason(error) === semanticReasonCodes.SOURCE_PATH_REFUSED,
  );
});

test("local Oxigraph accepts bounded SELECT, ASK and CONSTRUCT", async () => {
  const store = await open();
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
  assert.equal(store.snapshot().quadCount, 11, "refused queries cannot mutate the store");
});

test("SHACL validation conforms for valid data and returns a bounded invalid report", async () => {
  const valid = await open();
  const validReport = await valid.validateShacl({
    shapeGraphs: ["urn:test:graph:shapes"],
    dataGraphs: ["urn:test:graph:data"],
    maxResults: 1,
  });
  assert.deepEqual(validReport, { conforms: true, results: [], resultCount: 0, truncated: false });

  const invalid = await open("manifest-invalid-data.json");
  const invalidReport = await invalid.validateShacl({
    shapeGraphs: ["urn:test:graph:shapes"],
    dataGraphs: ["urn:test:graph:data"],
    maxResults: 1,
  });
  assert.equal(invalidReport.conforms, false);
  assert.equal(invalidReport.results.length, 1);
  assert.equal(invalidReport.results[0]?.focusNode.value, "urn:test:service-invalid");
  assert.equal(invalidReport.results[0]?.sourceConstraintComponent.value, "http://www.w3.org/ns/shacl#MinCountConstraintComponent");
  assert.equal(invalidReport.truncated, false);
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
