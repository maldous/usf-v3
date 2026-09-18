import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

test("both Hermes runtimes share bounded conditional repair selection without effects", () => {
  const script = String.raw`
import assert from "node:assert/strict";
import { mock } from "node:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { canonicalDigest } from "./src/core/canonical.ts";
const register = (path, namedExports) => mock.module(pathToFileURL(resolve(path)).href, { namedExports });
const forbidden = () => { throw new Error("UNEXPECTED_EFFECT"); };
const manifestPath = "graph/manifests/repair-fixture.json";
const prefix = "urn:test:binding:repair:";
const ids = [0, 1, 2].map(round => prefix + round);
const issueUuid = "123e4567-e89b-42d3-a456-426614174000";
const quad = (subject, name, object, objectKind = "literal") => ({
  subject, predicate: "urn:usf:predicate:" + name, object, objectKind,
  graph: "urn:test:graph:repair", canonical: ""
});
let declarations = [], states = [], calls = [], refusal = null, drift = false;
const policyFor = round => ({
  rootBinding: ids[0], round, maximumRounds: 2,
  ...(round === 0 ? {} : { predecessorBinding: ids[round - 1] })
});
function reset(scenario) {
  calls = []; states = scenario.states; refusal = scenario.refusal ?? null; drift = scenario.drift ?? false;
  declarations = ids.flatMap((subject, round) => [
    quad(subject, "type", "urn:usf:type:LinearIssueWorkBinding", "iri"),
    quad(subject, "issueWorkspace", "fixture"), quad(subject, "issueUuid", issueUuid),
    quad(subject, "owningModel", "USF"), quad(subject, "selectedProfile", "urn:test:profile:repair", "iri"),
    quad(subject, "targetManifest", manifestPath), quad(subject, "workIri", "urn:test:work:repair", "iri"),
    quad(subject, "fixedPrompt", "Only exact source replacements within the current contract."),
    quad(subject, "maximumPromptTokens", "12000"), quad(subject, "maximumOutputTokens", "8192"),
    quad(subject, "sourceContext", JSON.stringify([{ path: "src/fixture.ts", start: "BEGIN", end: "END", maximumBytes: 1024 }])),
    ...(!scenario.legacy ? [quad(subject, "candidateRepair", JSON.stringify(policyFor(round)))] : []),
    ...(round ? [quad(subject, "supersedesBinding", ids[round - 1], "iri")] : [])
  ]);
}
register("src/graph/index.ts", { loadSemanticGraph: () => ({ quads: declarations }), objectValues: () => [] });
register("src/graph/work.ts", { deriveWork: forbidden });
register("src/commands/linear-binding.ts", {
  observeLinearBinding: async selector => {
    calls.push(selector.bindingIri);
    const round = ids.indexOf(selector.bindingIri);
    assert.notEqual(round, -1);
    if (refusal && round === refusal.round) {
      throw Object.assign(new Error(refusal.code), { reasonCode: refusal.code });
    }
    const policyRow = declarations.find(q => q.subject === selector.bindingIri && q.predicate.endsWith(":candidateRepair"));
    const authority = {
      bindingIri: selector.bindingIri, locator: "fixture:" + issueUuid, workspace: "fixture",
      owner: "USF", issueUuid, workIri: "urn:test:work:repair",
      ...(policyRow ? { candidateRepair: JSON.parse(policyRow.object) } : {})
    };
    if (drift && calls.length === 1) {
      declarations.find(q => q.subject === ids[0] && q.predicate.endsWith(":fixedPrompt")).object = "Changed while awaiting observation.";
    }
    const state = states[round] ?? "PREPARED";
    return {
      status: state,
      binding: {
        authority, basis: { basisDigest: canonicalDigest("fixture basis") },
        attempt: { state: state === "COMPLETED" ? "SETTLED" : state },
        unit: { packet: { id: authority.workIri, semanticDependencies: [], readSet: [],
          writeSet: ["src/fixture.ts"], modelCapabilities: [], privacy: "public", dependsOn: [] } }
      }
    };
  }
});
register("src/providers/config.ts", { loadCredentialEnvFile: forbidden });
register("src/commands/linear-client.ts", { LinearClient: class {}, parseLinearPolicy: forbidden, readLinearPolicySource: forbidden });
register("src/commands/linear-state.ts", { LinearStateStore: class {}, readLinearRecord: forbidden, writeLinearRecord: forbidden });
register("src/continuous/lifecycle.ts", { linuxProcessInspector: forbidden });
register("src/continuous/stewardship.ts", {
  acquireSupervisorLifetimeLock: forbidden, claimStewardship: forbidden, releaseStewardship: forbidden, withSupervisorActivity: forbidden
});
register("src/commands/hermes-stewardship.ts", { currentStewardshipDependencies: forbidden });
register("src/commands/hermes-supervisor-foreground.ts", {
  registerForegroundSupervisor: forbidden, unregisterForegroundSupervisor: forbidden, foregroundSupervisorStopRequested: forbidden
});
register("src/graph/runtime-authority.ts", { readRuntimeAuthority: forbidden });
register("src/commands/linear-delivery.ts", { executeLinearDelivery: forbidden });
const autonomy = await import("./src/commands/hermes-linear-autonomy.ts");
const foreground = await import("./src/commands/hermes-linear.ts");
const scenarios = [
  { name: "prepared root retains admission", states: ["PREPARED"], selected: 0, calls: [0] },
  { name: "known rejected parent unlocks first repair", states: ["SETTLED", "PREPARED"], selected: 1, calls: [0, 1] },
  { name: "restart advances retained chain without resetting budget", states: ["SETTLED", "SETTLED", "PREPARED"], selected: 2, calls: [0, 1, 2] },
  { name: "final retained attempt remains terminal", states: ["SETTLED", "SETTLED", "SETTLED"], selected: 2, calls: [0, 1, 2] },
  { name: "valid candidate keeps original delivery", states: ["SETTLED"], selected: 0, calls: [0, 1],
    refusal: { round: 1, code: "LINEAR_BINDING_REPAIR_NOT_ADMITTED" } },
  { name: "started outcome cannot select repair", states: ["STARTED"], selected: 0, calls: [0] },
  { name: "unknown outcome cannot select repair", states: ["UNKNOWN"], selected: 0, calls: [0] },
  { name: "provider refusal is not candidate rejection", states: ["REFUSED"], selected: 0, calls: [0] },
  { name: "unknown child cannot select grandchild", states: ["SETTLED", "UNKNOWN"], selected: 1, calls: [0, 1] },
  { name: "completion never selects a repair", states: ["COMPLETED"], selected: 0, calls: [0] },
  { name: "child completion is terminal", states: ["SETTLED", "COMPLETED"], selected: 1, calls: [0, 1] },
  { name: "basis drift blocks without fallback", states: ["SETTLED"], blocked: 1, code: "LINEAR_BINDING_BASIS_NONCURRENT",
    calls: [0, 1], refusal: { round: 1, code: "LINEAR_BINDING_BASIS_NONCURRENT" } },
  { name: "invalid predecessor evidence blocks without fallback", states: ["SETTLED"], blocked: 1, code: "LINEAR_BINDING_RESULT_INVALID",
    calls: [0, 1], refusal: { round: 1, code: "LINEAR_BINDING_RESULT_INVALID" } },
  { name: "post-await graph drift is refused", states: ["PREPARED"], blocked: 0, code: "LINEAR_BINDING_AUTHORITY_MISMATCH",
    calls: [0], drift: true },
  { name: "legacy unconditional supersession is unchanged", states: [], selected: 2, calls: [2], legacy: true },
  { name: "duplicate manifest closures do not duplicate repair", states: ["SETTLED", "PREPARED"], selected: 1,
    calls: [0, 1], duplicateManifest: true }
];
let checked = 0;
for (const runtime of [autonomy, foreground]) {
  for (const scenario of scenarios) {
    reset(scenario);
    const result = await runtime.discoverLinearLanes("/fixture", scenario.duplicateManifest ? [manifestPath, manifestPath] : [manifestPath]);
    assert.deepEqual(calls, scenario.calls.map(round => ids[round]), scenario.name + " observation order");
    if (scenario.blocked !== undefined) {
      assert.equal(result.lanes.length, 0, scenario.name);
      assert.equal(result.blocked.length, 1, scenario.name);
      assert.equal(result.blocked[0].bindingIri, ids[scenario.blocked], scenario.name);
      assert.equal(result.blocked[0].reasonCode, scenario.code, scenario.name);
    } else {
      assert.deepEqual(result.blocked, [], scenario.name);
      assert.equal(result.lanes.length, 1, scenario.name);
      assert.equal(result.lanes[0].selector.bindingIri, ids[scenario.selected], scenario.name);
    }
    checked++;
  }
}
assert.equal(foreground.currentLinearBindingSelections, autonomy.currentLinearBindingSelections);
assert.equal(foreground.discoverLinearLanes, autonomy.discoverLinearLanes);
assert.equal(foreground.compatibleLinearLanes, autonomy.compatibleLinearLanes);
console.log(JSON.stringify({ checked, sharedSelection: true, effects: 0 }));
`;
  const result = spawnSync(process.execPath, ["--experimental-test-module-mocks", "--input-type=module", "-e", script], {
    cwd: resolve(import.meta.dirname, "../../.."), encoding: "utf8", timeout: 30000,
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.deepEqual(JSON.parse(result.stdout.trim()), { checked: 32, sharedSelection: true, effects: 0 });
});
