import assert from "node:assert/strict";
import test from "node:test";
import { deriveLinearBindingDeclaration, LinearBindingError } from "../../../src/graph/linear-binding.ts";
import type { SemanticGraph } from "../../../src/graph/index.ts";

const id = "urn:test:binding", P = "urn:usf:predicate:";
function fixture(): SemanticGraph {
  const fields: readonly [string, string, "iri" | "literal"][] = [
    ["type", "urn:usf:type:LinearIssueWorkBinding", "iri"],
    ["issueWorkspace", "workspace-main", "literal"],
    ["issueUuid", "123E4567-E89B-42D3-A456-426614174000", "literal"],
    ["canonicalIssueLocator", "workspace-main:123e4567-e89b-42d3-a456-426614174000", "literal"],
    ["owningModel", "USF", "literal"], ["selectedProfile", "urn:test:profile:1", "iri"],
    ["targetManifest", "graph/manifests/test.json", "literal"], ["workIri", "urn:test:work", "iri"],
    ["fixedPrompt", "Graph-derived work only.", "literal"], ["maximumPromptTokens", "20000", "literal"],
    ["supersedesBinding", "urn:test:prior", "iri"],
  ];
  return { quads: fields.map(([field, object, objectKind]) => ({ subject: id, predicate: P + field, object, objectKind, graph: "urn:test:graph", canonical: "" })),
    manifest: { schema: "urn:usf:graph-manifest:2", version: 2, imports: [], sources: [] },
    semanticDigest: "untrusted", graphDigests: {}, sourceDigests: {}, repositoryRoot: "/unused" };
}

test("binding declaration is immutable and preserves semantic identities without runtime admission", () => {
  const graph = fixture(), before = JSON.stringify(graph);
  const value = deriveLinearBindingDeclaration(graph, id);
  assert.deepEqual(value, { bindingIri: id, workspace: "workspace-main", issueUuid: "123e4567-e89b-42d3-a456-426614174000",
    locator: "workspace-main:123e4567-e89b-42d3-a456-426614174000", owner: "USF", profile: "urn:test:profile:1",
    targetManifest: "graph/manifests/test.json", workIri: "urn:test:work", fixedPrompt: "Graph-derived work only.", maximumPromptTokens: 20000, supersedes: "urn:test:prior" });
  assert(Object.isFrozen(value)); assert.equal(JSON.stringify(graph), before);
  graph.quads = graph.quads.filter(q => ![P + "canonicalIssueLocator", P + "supersedesBinding"].includes(q.predicate));
  assert.equal(deriveLinearBindingDeclaration(graph, id).supersedes, null);
});

test("every binding field rejects wrong and mixed object kinds before interpreting values", () => {
  for (let i = 0; i < fixture().quads.length; i++) for (const mixed of [false, true]) {
    const graph = fixture(), row = graph.quads[i]!;
    const wrong = { ...row, objectKind: row.objectKind === "iri" ? "literal" as const : "iri" as const };
    if (mixed) graph.quads.push(wrong); else graph.quads[i] = wrong;
    assert.throws(() => deriveLinearBindingDeclaration(graph, id), { reasonCode: "LINEAR_BINDING_FIELD_KIND_INVALID" }, row.predicate);
  }
});

test("binding cardinality rejects duplicate fields, ambiguous types and missing required values", () => {
  for (const row of fixture().quads) {
    const graph = fixture(); graph.quads.push({ ...row });
    assert.throws(() => deriveLinearBindingDeclaration(graph, id), LinearBindingError, row.predicate);
    if (![P + "supersedesBinding", P + "canonicalIssueLocator"].includes(row.predicate)) {
      const missing = fixture(); missing.quads = missing.quads.filter(q => q.predicate !== row.predicate);
      assert.throws(() => deriveLinearBindingDeclaration(missing, id), LinearBindingError, row.predicate);
    }
  }
  const graph = fixture(); graph.quads.push({ ...graph.quads[0]!, object: "urn:usf:type:WorkPacket" });
  assert.throws(() => deriveLinearBindingDeclaration(graph, id), { reasonCode: "LINEAR_BINDING_GRAPH_BINDING_MISSING" });
  assert.throws(() => deriveLinearBindingDeclaration(graph, "urn:test:absent"), { reasonCode: "LINEAR_BINDING_GRAPH_BINDING_MISSING" });
});

test("binding values refuse unsafe manifests, noncanonical integers, malformed identities and locators", () => {
  const cases: readonly [string, readonly string[], string][] = [
    ["targetManifest", ["../outside.json", "/tmp/manifest.json", "graph/../manifest.json", ".usf/private.json", ""], "LINEAR_BINDING_MANIFEST_MISSING"],
    ["maximumPromptTokens", ["0", "-1", "01", "+1", "1.0", "1e3", " 1", "9007199254740992"], "LINEAR_BINDING_PROMPT_POLICY_INVALID"],
    ["issueWorkspace", ["../other", "bad workspace"], "LINEAR_BINDING_LOCATOR_INVALID"],
    ["issueUuid", ["unknown", "123e4567-e89b-02d3-a456-426614174000"], "LINEAR_BINDING_LOCATOR_INVALID"],
    ["canonicalIssueLocator", ["other:123e4567-e89b-42d3-a456-426614174000"], "LINEAR_BINDING_LOCATOR_INVALID"],
    ["owningModel", ["unknown", "usf"], "LINEAR_BINDING_OWNER_INVALID"],
    ["selectedProfile", ["not-iri", "urn:test:bad value", "urn:" + "x".repeat(4093)], "LINEAR_BINDING_PROFILE_MISSING"],
    ["workIri", ["", "not-iri"], "LINEAR_BINDING_WORK_MISSING"],
    ["supersedesBinding", ["", "not-iri"], "LINEAR_BINDING_SUPERSESSION_INVALID"],
    ["fixedPrompt", ["", "x".repeat(4 * 1024 * 1024 + 1)], "LINEAR_BINDING_PROMPT_POLICY_INVALID"],
  ];
  for (const [field, values, reasonCode] of cases) for (const value of values) {
    const graph = fixture(); graph.quads.find(q => q.predicate === P + field)!.object = value;
    assert.throws(() => deriveLinearBindingDeclaration(graph, id), { reasonCode }, field);
  }
  const graph = fixture(); graph.quads.find(q => q.predicate === P + "maximumPromptTokens")!.object = String(Number.MAX_SAFE_INTEGER);
  assert.equal(deriveLinearBindingDeclaration(graph, id).maximumPromptTokens, Number.MAX_SAFE_INTEGER);
  for (const selector of ["", "not-iri", "urn:" + "x".repeat(4093)]) assert.throws(() => deriveLinearBindingDeclaration(graph, selector), { reasonCode: "LINEAR_BINDING_SELECTOR_INVALID" });
});
