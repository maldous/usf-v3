import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { loadSemanticGraph, type GraphManifestSource, type LoadedSemanticGraph } from "../../../src/graph/index.ts";
import { semanticContracts } from "../../../src/graph/query.ts";
import { deriveWork, semanticWorkPackets } from "../../../src/graph/work.ts";
import { assertBasisMatchesPacket } from "../../../src/realisation/basis.ts";

const root = resolve(import.meta.dirname, "../../..");
const selfHostManifest = "graph/manifests/self-host.json";
const selfHostHermesManifest = "graph/manifests/self-host-hermes.json";
const anqrManifest = "graph/products/anqr/manifest.json";
const anqrHermesManifest = "graph/products/anqr/hermes-manifest.json";
const orchardManifest = "graph/fixtures/product-assets.manifest.json";
const allManifest = "graph/fixtures/all-overlays.manifest.json";

function profilePacket(manifest: string, profile: string, workId: string) {
  const result = deriveWork(loadSemanticGraph(root, manifest), { selector: `profile:${profile}` });
  assert.equal(result.status, "ok");
  const packet = result.items?.find((item) => item.id === workId);
  assert.ok(packet);
  return packet;
}

test("the default reusable foundation contains no product contract or work", () => {
  const graph = loadSemanticGraph(root);
  assert.deepEqual(semanticContracts(graph), []);
  assert.deepEqual(semanticWorkPackets(graph), []);
});

test("manifest overlays isolate products while safely deduplicating shared knowledge", () => {
  const selfHost = loadSemanticGraph(root, selfHostManifest);
  const anqr = loadSemanticGraph(root, anqrManifest);
  const orchard = loadSemanticGraph(root, orchardManifest);
  const all = loadSemanticGraph(root, allManifest);
  assert.deepEqual(semanticContracts(selfHost), [
    "urn:usf:contract:file-asset-index:1",
    "urn:usf:contract:foreground-lifecycle:1",
    "urn:usf:contract:operator-observability:1",
    "urn:usf:contract:repository-path-scope:1",
    "urn:usf:contract:semantic-first-order:1",
  ]);
  assert.deepEqual(semanticContracts(anqr), ["urn:usf:contract:anqr-decoded-payload:1"]);
  assert.deepEqual(semanticContracts(orchard), ["urn:fixture:contract:orchard-launch-assets:1"]);
  assert.deepEqual(semanticContracts(all), [
    "urn:fixture:contract:orchard-launch-assets:1",
    "urn:usf:contract:anqr-decoded-payload:1",
    "urn:usf:contract:file-asset-index:1",
    "urn:usf:contract:foreground-lifecycle:1",
    "urn:usf:contract:operator-observability:1",
    "urn:usf:contract:repository-path-scope:1",
    "urn:usf:contract:semantic-first-order:1",
  ]);
  assert.equal(all.sources.length, 5);
  assert.equal(all.manifests.length, 5);
});

test("a versioned profile selects an exact closure and unrelated product overlays do not stale it", () => {
  const profile = "urn:usf:profile:v3-self-host:1";
  const work = "urn:usf:work:repository-path-scope";
  const isolated = profilePacket(selfHostManifest, profile, work);
  const composed = profilePacket(allManifest, profile, work);
  assert.deepEqual(composed.decisionBoundary, {
    kind: "realisation-profile",
    root: profile,
    profileVersion: "1",
    product: "urn:usf:product:v3",
    foundation: "urn:usf:foundation:v3",
  });
  assert.equal(composed.scopedDependencyDigest, isolated.scopedDependencyDigest);
  assert.equal(composed.realisationBasis?.selection.manifestDigest, isolated.realisationBasis?.selection.manifestDigest);
  assert.ok(isolated.realisationBasis);
  assert.ok(composed.realisationBasis);
  assertBasisMatchesPacket(isolated.realisationBasis, isolated);
  assertBasisMatchesPacket(composed.realisationBasis, composed);
  assert.deepEqual(composed.writeSet, isolated.writeSet);
  assert.deepEqual(composed.modelCapabilities, isolated.modelCapabilities);
  assert.equal(composed.semanticDependencies.some((dependency) => dependency.key.includes("anqr") || dependency.key.includes("orchard")), false);
  assert.equal(composed.semanticDependencies.some((dependency) => dependency.key === profile), true);

  const expanded = loadSemanticGraph(root, allManifest);
  const unrelatedSource: GraphManifestSource = {
    path: "graph/fixtures/unrelated.nq",
    format: "application/n-quads",
    graph: "urn:fixture:graph:unrelated",
    role: "non-authoritative-product-fixture",
    validationProfile: "bootstrap-nquads-v1",
  };
  const withUnrelatedTopology: LoadedSemanticGraph = {
    ...expanded,
    sources: [...expanded.sources, unrelatedSource],
    manifests: [...expanded.manifests, {
      path: "graph/fixtures/unrelated.manifest.json",
      digest: `sha256:${"0".repeat(64)}`,
      manifest: { schema: "urn:usf:graph-manifest:2", version: 2, imports: [], sources: [unrelatedSource] },
    }],
  };
  const unrelated = deriveWork(withUnrelatedTopology, { profile, selector: work, maxItems: 1 }).items?.[0];
  assert.equal(unrelated?.realisationBasis?.selection.manifestDigest, isolated.realisationBasis?.selection.manifestDigest);

  const selectedGraph = "urn:usf:graph:foundation";
  const changedRole = "selected-foundation-fixture";
  const changedSelectedTopology: LoadedSemanticGraph = {
    ...expanded,
    sources: expanded.sources.map((source) => source.graph === selectedGraph ? { ...source, role: changedRole } : source),
    manifests: expanded.manifests.map((entry) => ({
      ...entry,
      manifest: {
        ...entry.manifest,
        sources: entry.manifest.sources.map((source) => source.graph === selectedGraph ? { ...source, role: changedRole } : source),
      },
    })),
  };
  const changed = deriveWork(changedSelectedTopology, { profile, selector: work, maxItems: 1 }).items?.[0];
  assert.notEqual(changed?.realisationBasis?.selection.manifestDigest, isolated.realisationBasis?.selection.manifestDigest);

  const undeclaredSelectedTopology: LoadedSemanticGraph = {
    ...expanded,
    manifests: expanded.manifests.map((entry) => ({
      ...entry,
      manifest: { ...entry.manifest, sources: entry.manifest.sources.filter((source) => source.graph !== selectedGraph) },
    })),
  };
  assert.throws(
    () => deriveWork(undeclaredSelectedTopology, { profile, selector: work, maxItems: 1 }),
    /BASIS_MANIFEST_SELECTION_INVALID/,
  );
});

test("Hermes facade authority stays product-neutral while ANQR binding requires its overlay", () => {
  const coreGraph = loadSemanticGraph(root, selfHostHermesManifest);
  const productGraph = loadSemanticGraph(root, anqrHermesManifest);
  const coreWork = "urn:usf:work:hermes-management-facade";
  const productWork = "urn:usf:work:hermes-bau-binding";
  const managementProfile = "urn:anqr:profile:hermes-bau:1";
  const ordinaryProductProfile = "urn:anqr:profile:bau:1";
  const intent = "urn:anqr:intent:hermes-bau:1";

  assert.equal(coreGraph.quads.some((quad) => [quad.subject, quad.predicate, quad.object, quad.graph].some((value) => value.startsWith("urn:anqr:"))), false);
  assert.deepEqual(semanticWorkPackets(coreGraph).filter((id) => id.includes("hermes")), [coreWork]);
  assert.deepEqual(deriveWork(coreGraph, { selector: productWork }), {
    schema: "urn:usf:work-result:1",
    status: "refused",
    reasonCode: "WORK_SELECTOR_UNKNOWN",
  });

  for (const iri of [intent, ordinaryProductProfile, managementProfile]) {
    assert.equal(productGraph.quads.some((quad) => quad.subject === iri), true);
  }
  const ordinary = deriveWork(productGraph, { selector: `profile:${ordinaryProductProfile}` });
  assert.equal(ordinary.status, "ok");
  assert.equal(ordinary.items?.some((packet) => packet.id === coreWork || packet.id === productWork), false);
  const selected = deriveWork(productGraph, { selector: `profile:${managementProfile}` });
  assert.equal(selected.status, "ok");
  assert.equal(selected.items?.some((packet) => packet.id === coreWork), true);
  const productPacket = selected.items?.find((packet) => packet.id === productWork);
  assert.ok(productPacket);
  for (const dependency of [
    "urn:usf:profile:v3-self-host-hermes:1",
    ordinaryProductProfile,
    managementProfile,
    intent,
  ]) {
    assert.equal(productPacket.semanticDependencies.some((entry) => entry.key === dependency), true);
  }

  const isolatedCore = deriveWork(coreGraph, { selector: coreWork }).items?.[0];
  const composedCore = deriveWork(productGraph, { selector: coreWork }).items?.[0];
  assert.ok(isolatedCore);
  assert.ok(composedCore);
  assert.equal(composedCore.scopedDependencyDigest, isolatedCore.scopedDependencyDigest);
  assert.equal(composedCore.semanticDependencies.some((entry) => entry.key.startsWith("urn:anqr:")), false);
});

test("a different product projects different creative assets and model capabilities with no engine branch", () => {
  const packet = profilePacket(orchardManifest, "urn:fixture:profile:orchard-launch:1", "urn:fixture:work:orchard-assets");
  assert.deepEqual(packet.modelCapabilities, ["copywriting", "design-token-authoring", "vector-illustration"]);
  assert.deepEqual(packet.artifacts, [
    {
      id: "urn:fixture:asset:orchard-design-tokens",
      artifactKind: "urn:usf:artifact-kind:design-tokens",
      mediaType: "application/json",
      targetPath: "tests/fixtures/generated/orchard/tokens.json",
      modelCapabilities: ["design-token-authoring"],
    },
    {
      id: "urn:fixture:asset:orchard-hero",
      artifactKind: "urn:usf:artifact-kind:vector-illustration",
      mediaType: "image/svg+xml",
      targetPath: "tests/fixtures/generated/orchard/hero.svg",
      modelCapabilities: ["vector-illustration"],
    },
    {
      id: "urn:fixture:asset:orchard-launch-copy",
      artifactKind: "urn:usf:artifact-kind:marketing-copy",
      mediaType: "text/markdown",
      targetPath: "tests/fixtures/generated/orchard/launch-copy.md",
      modelCapabilities: ["copywriting"],
    },
  ]);
  assert.equal(JSON.stringify(packet).toLowerCase().includes("anqr"), false);
  assert.equal(JSON.stringify(packet).toLowerCase().includes("qr-"), false);
});

test("ambient reusable knowledge cannot leak model capabilities into a product profile", () => {
  const graph = loadSemanticGraph(root, orchardManifest);
  const baseline = deriveWork(graph, { selector: "profile:urn:fixture:profile:orchard-launch:1" }).items?.[0]?.modelCapabilities;
  const planted = {
    ...graph,
    quads: [...graph.quads, {
      subject: "urn:usf:foundation:v3",
      predicate: "urn:usf:predicate:modelCapability",
      object: "unadopted-ambient-capability",
      objectKind: "literal" as const,
      graph: "urn:usf:graph:foundation",
      canonical: "planted ambient capability",
    }],
  };
  assert.deepEqual(deriveWork(planted, { selector: "profile:urn:fixture:profile:orchard-launch:1" }).items?.[0]?.modelCapabilities, baseline);
});

test("an incomplete unselected product packet cannot block a selected profile", () => {
  const graph = loadSemanticGraph(root, allManifest);
  const planted = {
    ...graph,
    quads: [...graph.quads, {
      subject: "urn:future:work:incomplete",
      predicate: "urn:usf:predicate:type",
      object: "urn:usf:type:WorkPacket",
      objectKind: "iri" as const,
      graph: "urn:future:graph:product",
      canonical: "planted incomplete unrelated work",
    }],
  };
  const result = deriveWork(planted, { selector: "profile:urn:usf:profile:v3-self-host:1" });
  assert.equal(result.status, "ok");
  assert.equal(result.items?.some((item) => item.id === "urn:usf:work:repository-path-scope"), true);
});

test("a profile refuses a work dependency it did not explicitly select", () => {
  const graph = loadSemanticGraph(root, orchardManifest);
  const planted = {
    ...graph,
    quads: [...graph.quads, {
      subject: "urn:fixture:work:orchard-assets",
      predicate: "urn:usf:predicate:dependsOn",
      object: "urn:unselected:work:shared",
      objectKind: "iri" as const,
      graph: "urn:fixture:graph:orchard-product",
      canonical: "planted unselected dependency",
    }],
  };
  assert.equal(
    deriveWork(planted, { selector: "profile:urn:fixture:profile:orchard-launch:1" }).reasonCode,
    "REALISATION_PROFILE_DEPENDENCY_NOT_SELECTED:urn:fixture:profile:orchard-launch:1:urn:fixture:work:orchard-assets:urn:unselected:work:shared",
  );
});
