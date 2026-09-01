import assert from "node:assert/strict";
import { test } from "node:test";
import type { SemanticGraph } from "../../../src/graph/index.ts";
import { canonicalQuadLine, type Quad } from "../../../src/graph/nquads.ts";
import { projectEconomics, verifyEconomicsProjection } from "../../../src/providers/economics-projection.ts";

const G = "urn:usf:graph:v3-execution";
const P = "urn:usf:predicate:";
function quad(subject: string, predicate: string, object: string, objectKind: "iri" | "literal" = "literal"): Quad {
  const built = { subject, predicate, object, objectKind, graph: G, canonical: "" };
  built.canonical = canonicalQuadLine(built);
  return built;
}
function authorization(name: string, transport: string, provider: string, entitlement: string): Quad[] {
  const iri = `urn:usf:economic-authorization:${name}:1`;
  return [
    quad(iri, `${P}type`, "urn:usf:type:OperatorEconomicAuthorization", "iri"),
    quad(iri, `${P}authorizesTransport`, `urn:usf:execution-transport:${transport}`, "iri"),
    quad(iri, `${P}authorizesProvider`, provider),
    quad(iri, `${P}entitlement`, entitlement),
    quad(iri, `${P}basis`, "operator-declared"),
    quad(iri, `${P}maximumPaidCostUsd`, "0"),
    quad(iri, `${P}evidence`, "documented"),
    quad(iri, `${P}sourceDocumentation`, "https://example.invalid"),
  ];
}
function graphOf(quads: readonly Quad[]): SemanticGraph {
  return Object.freeze({ quads: Object.freeze([...quads]) }) as unknown as SemanticGraph;
}
const policy = "urn:usf:economic-policy:zero-paid:1";
function baseQuads(): Quad[] {
  return [
    ...authorization("vercel-ai-sdk-groq", "vercel-ai-sdk", "groq", "free-quota"),
    quad(policy, `${P}additionalAcceptedCostClass`, "subscription-included"),
    quad(policy, `${P}nonClaim`, "not an observed account tier"),
  ];
}

test("the projection is derived from the graph, sorted and complete", () => {
  const projected = projectEconomics(graphOf([
    ...baseQuads(),
    ...authorization("claude-cli-claude-cli", "claude-cli", "claude-cli", "subscription-included"),
  ]));
  assert.equal(projected.generated, true);
  assert.deepEqual(projected.authorizations.map((entry) => `${entry.transport}:${entry.provider}`),
    ["claude-cli:claude-cli", "vercel-ai-sdk:groq"]);
  assert.deepEqual(projected.additionalAcceptedCostClasses, ["subscription-included"]);
  assert.match(projected.sourceGraphDigest, /^sha256:[0-9a-f]{64}$/u);
});

test("projection identity is independent of quad order", () => {
  const quads = baseQuads();
  assert.equal(projectEconomics(graphOf(quads)).sourceGraphDigest,
    projectEconomics(graphOf([...quads].reverse())).sourceGraphDigest);
});

test("an incomplete authorization fails closed rather than projecting a partial policy", () => {
  const incomplete = authorization("x-y", "vercel-ai-sdk", "groq", "free-quota")
    .filter((entry) => entry.predicate !== `${P}evidence`);
  assert.throws(() => projectEconomics(graphOf(incomplete)), /ECONOMICS_AUTHORIZATION_INCOMPLETE/u);
});

test("verification accepts a faithful projection and rejects every unfaithful one", () => {
  const graph = graphOf(baseQuads());
  const faithful = projectEconomics(graph);
  assert.equal(verifyEconomicsProjection(faithful, graph).verified, true);

  // Not marked as derived at all.
  assert.throws(() => verifyEconomicsProjection({ ...faithful, generated: false }, graph), /NOT_DERIVED/u);
  // A stale digest: the graph moved after the projection was written.
  assert.throws(() => verifyEconomicsProjection({ ...faithful, sourceGraphDigest: `sha256:${"0".repeat(64)}` }, graph), /STALE/u);
  // A hand-edited body riding a correct digest.
  assert.throws(() => verifyEconomicsProjection({
    ...faithful,
    authorizations: [...faithful.authorizations, {
      transport: "vercel-ai-sdk", provider: "openrouter", entitlement: "free-quota",
      basis: "hand-edited", maximumPaidCostUsd: 0, evidence: "x", sourceDocumentation: "x",
    }],
  }, graph), /DIVERGED/u);
  // A hand-added cost class riding a correct digest.
  assert.throws(() => verifyEconomicsProjection({
    ...faithful, additionalAcceptedCostClasses: ["subscription-included", "paid"],
  }, graph), /DIVERGED/u);
});

test("withdrawing a cost class from the graph changes the projection and its identity", () => {
  const withClass = graphOf(baseQuads());
  const withoutClass = graphOf(baseQuads().filter(
    (entry) => !(entry.subject === policy && entry.predicate === `${P}additionalAcceptedCostClass`),
  ));
  const before = projectEconomics(withClass);
  const after = projectEconomics(withoutClass);
  assert.deepEqual(after.additionalAcceptedCostClasses, []);
  assert.notEqual(after.sourceGraphDigest, before.sourceGraphDigest);
  // The old projection must not verify against the new graph.
  assert.throws(() => verifyEconomicsProjection(before, withoutClass), /STALE/u);
});
