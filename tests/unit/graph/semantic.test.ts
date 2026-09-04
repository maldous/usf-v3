import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadSemanticGraph } from "../../../src/graph/index.ts";
import { parseStrictNQuads } from "../../../src/graph/nquads.ts";
import { queryGraph } from "../../../src/graph/query.ts";
import { canSatisfyEnvironment, deriveWork, isWorkPacketFresh } from "../../../src/graph/work.ts";

const root = resolve(import.meta.dirname, "../../..");
const contract = "urn:anqr:contract:decoded-payload:1";
const manifest = "graph/products/anqr/manifest.json";

test("strict bootstrap N-Quads are blank-node-free and compile to a stable content digest", () => {
  const source = readFileSync(resolve(root, "graph/anqr-first-slice.nq"), "utf8");
  const parsed = parseStrictNQuads(source, "urn:anqr:graph:decoded-payload");
  assert.ok(parsed.length > 20);
  assert.throws(() => parseStrictNQuads("_:b <urn:p> <urn:o> <urn:g> .", "urn:g"), /NQUADS_UNSUPPORTED_SYNTAX/);
  assert.equal(loadSemanticGraph(root, manifest).semanticDigest, loadSemanticGraph(root, manifest).semanticDigest);
});

test("bounded query is exact, refuses unknown selectors, and reports truncation", () => {
  const graph = loadSemanticGraph(root, manifest);
  const exact = queryGraph(graph, { contract });
  assert.equal(exact.status, "ok");
  assert.equal(exact.items?.[0]?.iri, contract);
  assert.equal(queryGraph(graph, { selector: "SPARQL SELECT * WHERE {}" }).reasonCode, "QUERY_SELECTOR_UNKNOWN");
  const bounded = queryGraph(graph, { selector: "work", maxItems: 1 });
  assert.equal(bounded.truncation?.maxItems, 1);
  assert.equal(bounded.truncation?.truncated, true);
});

test("work packets are deterministic and construction readiness requires profile-bound semantic authority", () => {
  const graph = loadSemanticGraph(root, manifest);
  const all = deriveWork(graph, { selector: `contract:${contract}` });
  assert.equal(all.status, "ok");
  assert.equal(all.items?.length, 2);
  assert.deepEqual(all.items, deriveWork(graph, { selector: `contract:${contract}` }).items);
  assert.equal(deriveWork(graph, { selector: "unknown" }).reasonCode, "WORK_SELECTOR_UNKNOWN");
  const implementation = all.items?.find((item) => item.id === "urn:anqr:work:implementation");
  assert.ok(implementation);
  assert.deepEqual(implementation.environmentPosture, [
    { binding: "urn:anqr:environment-applicability:decoded-payload:ci", environment: "urn:usf:environment:ci", applicability: "reserved" },
    { binding: "urn:anqr:environment-applicability:decoded-payload:hermetic", environment: "urn:usf:environment:hermetic", applicability: "required" },
    { binding: "urn:anqr:environment-applicability:decoded-payload:integrationtest", environment: "urn:usf:environment:integrationtest", applicability: "required" },
    { binding: "urn:anqr:environment-applicability:decoded-payload:localdev", environment: "urn:usf:environment:localdev", applicability: "required" },
    { binding: "urn:anqr:environment-applicability:decoded-payload:productionlive", environment: "urn:usf:environment:productionlive", applicability: "reserved" },
    { binding: "urn:anqr:environment-applicability:decoded-payload:productionshaped", environment: "urn:usf:environment:productionshaped", applicability: "reserved" },
    { binding: "urn:anqr:environment-applicability:decoded-payload:staging", environment: "urn:usf:environment:staging", applicability: "reserved" },
  ]);
  assert.equal(implementation.validationPlan[0]?.executionMode, "urn:usf:mode:deterministic-test-substitute");
  assert.equal(implementation.validationPlan[0]?.environment, "urn:usf:environment:hermetic");
  assert.equal(implementation.validationPlan[0]?.applicability, "required");
  assert.equal(implementation.targetRuntimeProvider, "none");
  assert.deepEqual(implementation.modelCapabilities, ["node-test", "typescript"]);
  assert.equal(implementation.acceptanceCriteria.length, 7);
  assert.equal(implementation.semanticDependencies.some((dependency) => dependency.key === "urn:anqr:acceptance:url"), true);
  assert.equal(implementation.semanticDependencies.some((dependency) => dependency.kind === "policy" && dependency.key === "config/privacy.json"), true);
  assert.equal(implementation.semanticDependencies.some((dependency) => dependency.kind === "schema" && dependency.key === "apps/anqr/contract.schema.json"), true);
  assert.equal(implementation.semanticDependencies.some((dependency) => dependency.kind === "tool" && dependency.key === "pnpm-lock.yaml"), true);
  assert.equal(canSatisfyEnvironment(implementation, "urn:usf:environment:hermetic"), true);
  assert.equal(canSatisfyEnvironment(implementation, "urn:usf:environment:staging"), false);
  assert.equal(canSatisfyEnvironment(implementation, "urn:usf:environment:absent"), false);
  assert.equal(implementation.eligibility?.dependencyReady, true);
  assert.equal(all.items?.find((item) => item.id === "urn:anqr:work:tests")?.eligibility?.dependencyReady, false);
  assert.equal(deriveWork(graph, { ready: true }).reasonCode, "REALISATION_PROFILE_REQUIRED");
  assert.deepEqual(deriveWork(graph, { profile: "urn:anqr:profile:decoded-payload-bootstrap:1", ready: true }).items, []);
  const allIds = deriveWork(graph).items?.map((item) => item.id) ?? [];
  const shardOne = deriveWork(graph, { shard: "1/2" }).items?.map((item) => item.id) ?? [];
  const shardTwo = deriveWork(graph, { shard: "2/2" }).items?.map((item) => item.id) ?? [];
  assert.deepEqual([...shardOne, ...shardTwo].sort(), allIds);
  assert.deepEqual(shardOne.filter((id) => shardTwo.includes(id)), []);
  assert.equal(deriveWork(graph, { shard: "0/2" }).reasonCode, "WORK_SHARD_INVALID");
  assert.equal(deriveWork(graph, { stream: true }).outputMode, "jsonl");
  assert.equal(isWorkPacketFresh(implementation, implementation.semanticDependencies), true);
  const moved = implementation.semanticDependencies.map((dependency) => dependency.key === implementation.id ? { ...dependency, digest: "sha256:moved" } : dependency);
  assert.equal(isWorkPacketFresh(implementation, moved), false);
  const unrelated = [...implementation.semanticDependencies, { key: "urn:usf:unrelated", digest: "sha256:moved", kind: "semantic-resource" as const }];
  assert.equal(isWorkPacketFresh(implementation, unrelated), true);
});
