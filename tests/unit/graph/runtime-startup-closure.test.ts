import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { objectValues } from "../../../src/graph/index.ts";
import {
  createRuntimeStartupAudit, createStartupWalker, staticRuntimeSpecifiers, syntheticSecondaryClosureFiles,
  type StartupSelection,
} from "../../fixtures/runtime-startup-closure.ts";

const root = resolve(import.meta.dirname, "../../..");
const audit = createRuntimeStartupAudit(root);
const helperPath = "src/core/linear-repair.ts";
const importerPath = "src/graph/linear-binding.ts";
const predicate = (name: string) => `urn:usf:predicate:${name}`;

const syntaxCases: ReadonlyArray<readonly [string, string, readonly string[]]> = [
  ["default, named and mixed imports", `import value from './default.ts';
    import { type Shape, run } from './mixed.ts'; import * as all from './namespace.ts';`,
  ["./default.ts", "./mixed.ts", "./namespace.ts"]],
  ["side-effect and empty imports", `import './side-effect.ts'; import {} from './empty.ts';`,
  ["./empty.ts", "./side-effect.ts"]],
  ["named, star and namespace re-exports", `export { run } from './named.ts';
    export * from './star.ts'; export * as namespace from './namespace.ts';`,
  ["./named.ts", "./namespace.ts", "./star.ts"]],
  ["explicit and inline type-only imports and exports", `import type Shape from './shape.ts';
    import { type Other } from './other.ts'; export type * from './types.ts';
    export type * as Types from './namespace-types.ts'; export { type Other } from './other.ts';`, []],
  ["mixed default with inline type-only bindings", `import value, { type Shape } from './default.ts';
    export { type Shape, value } from './mixed.ts';`, ["./default.ts", "./mixed.ts"]],
  ["comments, fixture strings and dynamic imports", `// import './comment.ts';
    const fixture = "export * from './fixture.ts'";
    const template = \`import './template.ts'\`; void import('./dynamic.ts');`, []],
];

for (const [name, source, expected] of syntaxCases) {
  test(`startup AST handles ${name}`, () => {
    assert.deepEqual(staticRuntimeSpecifiers("fixture.ts", source), expected);
  });
}

test("startup fixture traversal detects transitive omissions despite cached ambient source", () => {
  const sources = new Map([
    ["entry.ts", "export * as bridge from './bridge.ts'; import type T from './types.ts';"],
    ["bridge.ts", "import './leaf.ts'; export * from './entry.ts';"],
    ["leaf.ts", "export const leaf = true;"],
  ]);
  const reads: string[] = [];
  const walk = createStartupWalker(path => {
    reads.push(path);
    assert.ok(sources.has(path));
    return sources.get(path)!;
  });
  assert.deepEqual(walk(["entry.ts"], new Set(sources.keys())).missing, []);
  assert.deepEqual(walk(["entry.ts"], new Set(["entry.ts", "bridge.ts"])).missing,
    [{ from: "bridge.ts", specifier: "./leaf.ts", missing: "leaf.ts" }]);
  assert.deepEqual(reads.sort(), [...sources.keys()].sort(), "each source is parsed only once");
  assert.deepEqual(walk(["entry.ts"], new Set()).missing,
    [{ from: "<entry>", specifier: "entry.ts", missing: "entry.ts" }]);
  assert.throws(() => walk(["entry.ts"], new Set(["src/"])), /exact repository file path/u);
  const escaping = createStartupWalker(() => "import '../outside.ts';");
  assert.throws(() => escaping(["entry.ts"], new Set(["entry.ts"])), /exact repository file path/u);
});

const cases = [
  { name: "cli-transition-definition", work: "cli-transition-definition", profile: "cli-transition-definition:1",
    closure: "cli-transition-definition:1", validations: ["cli-transition-definition-adapter",
      "cli-transition-definition-adapter-contracts", "cli-transition-definition-runtime", "cli-transition-definition-installed-frontier"] },
  { name: "cli-transition-definition", work: "cli-transition-definition", profile: "cli-transition-definition:1",
    closure: "local-contribution:1", validations: ["local-contribution:1"] },
  { name: "self-host", work: "realisation-basis-chain", profile: "v3-self-host:1",
    closure: "realisation-basis-chain-focused:1", validations: ["realisation-basis-chain-focused"] },
  ...["linear-intent-reconciliation", "hermes-binding-recovery", "completion-clone-optimization",
    "linear-work-binding", "hermes-linear-autonomy"].map(name => ({
    name, work: name, profile: `${name}:1`, closure: `${name}:1`, validations: [name],
  })),
];

for (const selected of cases) {
  test(`graph startup closure ${selected.closure} includes its selected candidate dependencies`, context => {
    for (const validation of selected.validations) {
      const view = audit.view({ manifestPath: `graph/manifests/${selected.name}.json`,
        work: `urn:usf:work:${selected.work}`, profile: `urn:usf:profile:${selected.profile}`,
        validation: `urn:usf:validation:${validation}` });
      assert.equal(view.closure.id, `urn:usf:validation-runtime-closure:${selected.closure}`);
      const result = audit.walk(view.entries, view.files);
      assert.deepEqual(result.missing, [], `${validation}: missing startup dependency in candidate + supplemental union`);
      context.diagnostic(`${validation}: ${view.closure.repositoryReadFiles.length}/128 supplemental files; ${result.visited.length} startup files`);
    }
  });
}

const retainedSelection: StartupSelection = {
  manifestPath: "graph/manifests/cli-transition-definition.json",
  work: "urn:usf:work:cli-transition-definition",
  profile: "urn:usf:profile:cli-transition-definition:1",
  validation: "urn:usf:validation:cli-transition-definition-runtime",
};

test("work-completion retained startup rejects the omitted linear-repair helper in memory", () => {
  const view = audit.view(retainedSelection);
  const entry = "tests/contract/fake-call-resolve.test.ts";
  assert.ok(view.entries.includes(entry), "the real retained obligation must select the regression entry");
  assert.deepEqual(audit.walk([entry], view.files).missing, []);
  const omitted = new Set(view.files);
  assert.equal(omitted.delete(helperPath), true, "the repaired view must supply the helper");
  const red = audit.walk([entry], omitted);
  assert.ok(red.visited.includes(importerPath), "startup must reach the actual static importer");
  assert.deepEqual(red.missing, [{ from: importerPath, specifier: "../core/linear-repair.ts", missing: helperPath }]);
});

test("native Linear fixture selected copies supply the binding startup dependencies", () => {
  const view = audit.view({ manifestPath: "graph/manifests/linear-work-binding.json",
    work: "urn:usf:work:linear-work-binding", profile: "urn:usf:profile:linear-work-binding:1",
    validation: "urn:usf:validation:linear-work-binding" });
  const policies = view.graph.quads.filter(quad => quad.predicate === predicate("eligibleWork")
    && quad.object === view.work.id && objectValues(view.graph, quad.subject, predicate("type"))
      .includes("urn:usf:type:NoChangeWorkCompletionPublicationPolicy"));
  assert.equal(policies.length, 1, "the native fixture selects one completion policy");
  const checkGraph = audit.graphFor("graph/manifests/integration.json");
  const checkSchemas = objectValues(checkGraph, "urn:usf:schema:checked-candidate-execution-intent:1", predicate("repositoryPath"));
  assert.equal(checkSchemas.length, 1);
  // Startup projection of isolatedBindingRepository in linear-native-completion.test.ts.
  // Manifest/data reads and authority reconstruction remain integration obligations.
  const fixtureFiles = audit.materializedFiles([
    ...view.work.readSet, ...view.work.writeSet, ...view.basis.scope.readSet, ...view.basis.scope.writeSet,
    ...Object.keys(view.basis.scope.preimages), ...view.closure.repositoryReadFiles,
    ...view.basis.inputs.schemaDigests.map(input => input.id), ...view.basis.inputs.toolDigests.map(input => input.id),
    ...["schemaPath", "toolPath"].flatMap(name => objectValues(view.graph, policies[0]!.subject, predicate(name))),
    ...checkSchemas,
  ]);
  assert.deepEqual(audit.walk(view.entries, fixtureFiles).missing, []);
  assert.ok(fixtureFiles.has(helperPath));
  fixtureFiles.delete(helperPath);
  assert.ok(audit.walk(view.entries, fixtureFiles).missing.some(edge => edge.from === importerPath && edge.missing === helperPath));
});

const syntheticFixtureTitle = "integration consumes each graph-required validation exactly once in canonical order";
const syntheticMap = (array: string) => `...${array}.map((path) => `
  + '`<${secondaryClosure}> <urn:usf:predicate:repositoryReadFile> ${JSON.stringify(path)} <${graph}> .`)';
const syntheticSource = (...maps: string[]) =>
  `test(${JSON.stringify(syntheticFixtureTitle)}, async () => { statements.push(${maps.join(", ")}); });`;
const oneSyntheticMap = syntheticMap('["src/core/linear-repair.ts"]');

test("synthetic closure extraction selects only the exact fixture's mapped literal array", () => {
  const unrelated = syntheticSource(oneSyntheticMap).replace(syntheticFixtureTitle, "unrelated fixture");
  const source = `const decoy = ["src/decoy.ts"];\n${unrelated}\n${syntheticSource(oneSyntheticMap)}`;
  assert.deepEqual(syntheticSecondaryClosureFiles(source), [helperPath]);
});

const malformedSyntheticCases: ReadonlyArray<readonly [string, string, RegExp]> = [
  ["missing named callback", syntheticSource(oneSyntheticMap).replace(syntheticFixtureTitle, "unrelated fixture"), /exactly one named/u],
  ["duplicate named callbacks", syntheticSource(oneSyntheticMap) + syntheticSource(oneSyntheticMap), /exactly one named/u],
  ["missing mapped array", syntheticSource(), /exactly one secondaryClosure/u],
  ["ambiguous mapped arrays", syntheticSource(oneSyntheticMap, oneSyntheticMap), /exactly one secondaryClosure/u],
  ["nonliteral array", syntheticSource(syntheticMap("runtimeFiles")), /literal array/u],
  ["nonliteral member", syntheticSource(syntheticMap("[runtimeFile]")), /literal file paths/u],
  ["duplicate members", syntheticSource(syntheticMap('["src/a.ts", "src/a.ts"]')), /must be unique/u],
  ["empty array", syntheticSource(syntheticMap("[]")), /1 to 128/u],
  ["over-bound array", syntheticSource(syntheticMap(JSON.stringify(Array.from({ length: 129 }, (_, index) => `src/file-${index}.ts`)))), /1 to 128/u],
];

for (const [name, source, reason] of malformedSyntheticCases) {
  test(`synthetic closure extraction refuses ${name}`, () => {
    assert.throws(() => syntheticSecondaryClosureFiles(source), reason);
  });
}

test("the actual synthetic secondary closure supplies fake-call startup without canonical supplemental files", context => {
  const paths = syntheticSecondaryClosureFiles(readFileSync(resolve(root, "tests/unit/realisation/workspace.test.ts"), "utf8"));
  const view = audit.view({ manifestPath: "graph/manifests/self-host.json",
    work: "urn:usf:work:realisation-basis-chain", profile: "urn:usf:profile:v3-self-host:1",
    validation: "urn:usf:validation:realisation-basis-chain-focused" });
  const entry = "tests/contract/fake-call-resolve.test.ts";
  assert.ok(paths.includes(entry), "the actual synthetic array must contain its startup test");
  const supplementalFiles = audit.materializedFiles(paths);
  assert.equal(supplementalFiles.size, paths.length, "the synthetic array must name existing exact files");
  // The fixture replaces the validation binding on this work. Its candidate
  // files remain supplied, but the old obligation's supplemental files do not.
  const files = new Set([...view.candidateFiles, ...supplementalFiles]);
  assert.deepEqual(audit.walk([entry], files).missing, [], "synthetic secondaryClosure must close its own startup imports");
  assert.equal(files.delete(helperPath), true, "the repaired synthetic view must supply the helper");
  assert.deepEqual(audit.walk([entry], files).missing,
    [{ from: importerPath, specifier: "../core/linear-repair.ts", missing: helperPath }]);
  context.diagnostic(`actual synthetic secondaryClosure: ${paths.length}/128 supplemental files; omitted-helper control rejected`);
});
