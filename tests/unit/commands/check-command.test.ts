import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { inspectCheckCommand, type CheckCommandContractDetail, type CheckCommandContractInvalid } from "../../../src/core/check-command.ts";

const prefix = ["node", "--test", "--test-isolation=none"] as const;
const acceptancePath = "tests/fixtures/cli-provider-qualification-help.acceptance.ts";
const validCommands: readonly (readonly string[])[] = [
  [...prefix, "tests/unit/example.test.ts"],
  [...prefix, "--test-name-pattern=only-this_case.1", "tests/example.test.ts"],
  [...prefix, ...Array.from({ length: 8 }, (_, index) => `tests/${index}.test.ts`)],
  [...prefix, "--test-name-pattern=selected", ...Array.from({ length: 8 }, (_, index) => `tests/${index}.test.ts`)],
  [...prefix, ".tests/.fixture.test.ts", "tests/--allow-local.test.ts", "bare.test.ts"],
];

const invalidCommands: readonly Readonly<{
  name: string;
  command: readonly string[];
  detail: CheckCommandContractDetail;
}>[] = [
  { name: "missing command", command: [], detail: "ARGUMENT_COUNT_INVALID" },
  { name: "missing tests", command: prefix, detail: "ARGUMENT_COUNT_INVALID" },
  { name: "too many arguments", command: [...prefix, "--test-name-pattern=only", ...Array.from({ length: 9 }, (_, index) => `tests/${index}.test.ts`)], detail: "ARGUMENT_COUNT_INVALID" },
  { name: "empty argument", command: [...prefix, ""], detail: "EMPTY_ARGUMENT" },
  { name: "absolute executable", command: ["/usr/bin/node", ...prefix.slice(1), "tests/a.test.ts"], detail: "COMMAND_PREFIX_INVALID" },
  { name: "script execution", command: ["node", "--eval", "code", "tests/a.test.ts"], detail: "COMMAND_PREFIX_INVALID" },
  { name: "process isolation", command: ["node", "--test", "--test-isolation=process", "tests/a.test.ts"], detail: "COMMAND_PREFIX_INVALID" },
  { name: "empty pattern", command: [...prefix, "--test-name-pattern=", "tests/a.test.ts"], detail: "NAME_PATTERN_INVALID" },
  { name: "regexp pattern", command: [...prefix, "--test-name-pattern=^name.*$", "tests/a.test.ts"], detail: "NAME_PATTERN_INVALID" },
  { name: "spaced pattern", command: [...prefix, "--test-name-pattern=two words", "tests/a.test.ts"], detail: "NAME_PATTERN_INVALID" },
  { name: "pattern without tests", command: [...prefix, "--test-name-pattern=only"], detail: "TEST_COUNT_INVALID" },
  { name: "nine tests", command: [...prefix, ...Array.from({ length: 9 }, (_, index) => `tests/${index}.test.ts`)], detail: "TEST_COUNT_INVALID" },
  { name: "duplicate tests", command: [...prefix, "tests/a.test.ts", "tests/a.test.ts"], detail: "DUPLICATE_TEST_PATH" },
  { name: "acceptance suffix", command: [...prefix, acceptancePath], detail: "TEST_PATH_INVALID" },
  { name: "wrong extension", command: [...prefix, "tests/a.test.js"], detail: "TEST_PATH_INVALID" },
  { name: "absolute test", command: [...prefix, "/tests/a.test.ts"], detail: "TEST_PATH_INVALID" },
  { name: "parent traversal", command: [...prefix, "tests/../a.test.ts"], detail: "TEST_PATH_INVALID" },
  { name: "dot traversal", command: [...prefix, "./tests/a.test.ts"], detail: "TEST_PATH_INVALID" },
  { name: "empty segment", command: [...prefix, "tests//a.test.ts"], detail: "TEST_PATH_INVALID" },
  { name: "backslash", command: [...prefix, "tests\\a.test.ts"], detail: "TEST_PATH_INVALID" },
  { name: "wildcard", command: [...prefix, "tests/*.test.ts"], detail: "TEST_PATH_INVALID" },
  { name: "encoded traversal", command: [...prefix, "%2e%2e/a.test.ts"], detail: "TEST_PATH_INVALID" },
  { name: "NUL", command: [...prefix, "tests/a\0.test.ts"], detail: "TEST_PATH_INVALID" },
  { name: "extra test flag", command: [...prefix, "--test-concurrency=2", "tests/a.test.ts"], detail: "TEST_PATH_INVALID" },
  { name: "misplaced pattern", command: [...prefix, "tests/a.test.ts", "--test-name-pattern=only"], detail: "TEST_PATH_INVALID" },
  { name: "permission", command: [...prefix, "--permission", "tests/a.test.ts"], detail: "PERMISSION_ARGUMENT_FORBIDDEN" },
  { name: "permission disable", command: [...prefix, "--no-permission", "tests/a.test.ts"], detail: "PERMISSION_ARGUMENT_FORBIDDEN" },
  { name: "permission underscore", command: [...prefix, "--no_permission", "tests/a.test.ts"], detail: "PERMISSION_ARGUMENT_FORBIDDEN" },
  { name: "filesystem permission", command: [...prefix, "--allow-fs-read=*", "tests/a.test.ts"], detail: "PERMISSION_ARGUMENT_FORBIDDEN" },
  { name: "filesystem permission alias", command: [...prefix, "--allow_fs_write=/", "tests/a.test.ts"], detail: "PERMISSION_ARGUMENT_FORBIDDEN" },
  { name: "child permission", command: [...prefix, "--allow-child-process", "tests/a.test.ts"], detail: "PERMISSION_ARGUMENT_FORBIDDEN" },
  { name: "worker permission", command: [...prefix, "--no-allow-worker", "tests/a.test.ts"], detail: "PERMISSION_ARGUMENT_FORBIDDEN" },
];

// Evaluate the actual boundary bodies, not a second parser or a repository
// clone. Every graph/host effect is injected; no authority or sandbox is claimed.
const checkSource = readFileSync(new URL("../../../src/commands/check.ts", import.meta.url), "utf8");
const syntax = ts.createSourceFile("check.ts", checkSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const boundaryNames = new Set([
  "CheckRefusal", "refuse", "permissionAffectingNodeArgument", "strictNodeTestPaths",
  "confinedNodeTestLaunch", "graphValidation", "graphDerivedCheck",
]);
const declarations = syntax.statements.filter((node) =>
  (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name !== undefined && boundaryNames.has(node.name.text));
for (const required of ["CheckRefusal", "refuse", "confinedNodeTestLaunch", "graphValidation", "graphDerivedCheck"]) {
  assert.equal(declarations.filter((node) => (node as ts.FunctionDeclaration | ts.ClassDeclaration).name?.text === required).length, 1, required);
}
const boundaryScript = ts.transpileModule(declarations.map((node) => node.getText(syntax)).join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText + "\n({ confinedNodeTestLaunch, graphValidation, graphDerivedCheck });";

interface BoundaryResult {
  status: string;
  reasonCode?: string;
  commandContract?: CheckCommandContractInvalid;
  diagnosticDetails?: Readonly<Record<string, unknown>>;
  confinementFailure?: string;
}
interface Boundaries {
  confinedNodeTestLaunch(workspace: string, scratch: string, dependencies: readonly string[], command: readonly string[]): unknown;
  graphValidation(root: string, basis: unknown, id: string): unknown;
  graphDerivedCheck(root: string, candidate: string, id: string, reuse: boolean): Promise<BoundaryResult>;
}
const manifestPath = "graph/manifests/check-contract-unit.json";
const profile = "urn:test:profile";
const validationId = "urn:test:validation";
const basis = {
  selection: { manifestPath, profile, profileDigest: "profile-digest", profileVersion: "1" },
  trace: { validation: [{ id: validationId, digest: "validation-digest" }] },
};

function boundaries(command: readonly string[]) {
  let hostProbes = 0;
  let policyReads = 0;
  let launcherProbes = 0;
  const graph = { manifestPath, manifests: [{ path: manifestPath }] };
  const context = {
    exports: {},
    inspectCheckCommand,
    process: { allowedNodeEnvironmentFlags: new Set(["--permission", "--no-permission", "--allow-child-process"]) },
    loadSemanticGraph: () => graph,
    resourceDigest: (_graph: unknown, subject: string) => subject === profile ? "profile-digest" : "validation-digest",
    exactGraphType: () => undefined,
    exactGraphValue: (_graph: unknown, _subject: string, predicate: string) => {
      const values: Record<string, string> = {
        "urn:usf:predicate:version": "1",
        "urn:usf:predicate:command": command.join(" "),
        "urn:usf:predicate:environment": "urn:usf:environment:hermetic",
        "urn:usf:predicate:executionMode": "urn:usf:mode:confined-fixture-process:2",
        "urn:usf:predicate:applicability": "required",
      };
      assert.ok(predicate in values, predicate);
      return values[predicate];
    },
    readFixtureProcessPolicy: () => { policyReads += 1; return {}; },
    authenticateFixtureProcessHostProfile: () => { hostProbes += 1; return false; },
    trustedBubblewrap: () => { launcherProbes += 1; return false; },
    withCandidateLock: async (_root: string, _candidate: string, action: (root: string) => Promise<unknown>) => action("/unit-root"),
    executionIntentPresent: async () => false,
    candidateWorkspace: async () => "/unit-workspace",
    resetFocusedCheckTemporary: async () => "/unit-workspace/.usf-check-tmp",
    currentCandidateWorkspace: async () => ({ workspace: "/unit-workspace", basis }),
    stableReason: () => null,
  };
  return {
    actual: runInNewContext(boundaryScript, context) as Boundaries,
    counts: () => ({ hostProbes, policyReads, launcherProbes }),
  };
}

test("check command preserves the exact valid grammar and bounds", () => {
  for (const command of validCommands) {
    const result = inspectCheckCommand(Object.freeze([...command]));
    assert.equal(result.status, "valid", command.join(" "));
    if (result.status !== "valid") continue;
    assert.deepEqual(result.testPaths, command.slice(command[3]?.startsWith("--test-name-pattern=") ? 4 : 3));
    assert.ok(Object.isFrozen(result));
    assert.ok(Object.isFrozen(result.testPaths));
  }
});

test("check command gives stable typed refusals for unsafe grammar without normalization", () => {
  for (const { name, command, detail } of invalidCommands) {
    const result = inspectCheckCommand(Object.freeze([...command]));
    assert.equal(result.status, "invalid", name);
    if (result.status !== "invalid") continue;
    assert.equal(result.reasonCode, "CHECK_COMMAND_CONTRACT_INVALID", name);
    assert.equal(result.detail, detail, name);
    assert.ok(Object.isFrozen(result), name);
    if (result.invalidPaths !== undefined) assert.ok(Object.isFrozen(result.invalidPaths), name);
  }
});

test("check command results are detached from later caller edits", () => {
  const valid = [...prefix, "tests/a.test.ts"];
  const accepted = inspectCheckCommand(valid);
  valid[3] = acceptancePath;
  assert.deepEqual(accepted, { status: "valid", testPaths: ["tests/a.test.ts"] });
  const invalid = [...prefix, acceptancePath];
  const rejected = inspectCheckCommand(invalid);
  invalid[3] = "tests/a.test.ts";
  assert.deepEqual(rejected, {
    status: "invalid", reasonCode: "CHECK_COMMAND_CONTRACT_INVALID", detail: "TEST_PATH_INVALID",
    invalidPaths: [acceptancePath],
  });
});

test("actual confined launcher shares grammar and rejects invalid commands before host probing", () => {
  for (const command of [...validCommands, ...invalidCommands.map((entry) => entry.command)]) {
    const harness = boundaries(command);
    assert.equal(harness.actual.confinedNodeTestLaunch("/never-read", "/never-read/tmp", [], command), null);
    assert.deepEqual(harness.counts(), {
      hostProbes: 0, policyReads: 0, launcherProbes: inspectCheckCommand(command).status === "valid" ? 1 : 0,
    }, command.join(" "));
  }
});

test("graph preflight diagnoses acceptance suffix before any host or policy probe", () => {
  const command = [...prefix, acceptancePath];
  const harness = boundaries(command);
  assert.throws(() => harness.actual.graphValidation("/never-read", basis, validationId), (error: unknown) => {
    const refusal = error as { reasonCode?: string; commandContract?: CheckCommandContractInvalid };
    assert.equal(refusal.reasonCode, "CHECK_COMMAND_CONTRACT_INVALID");
    assert.deepEqual(refusal.commandContract, inspectCheckCommand(command));
    return true;
  });
  assert.deepEqual(harness.counts(), { hostProbes: 0, policyReads: 0, launcherProbes: 0 });
});

test("graph-derived check preserves the typed contract refusal for its callers", async () => {
  for (const command of [[...prefix, acceptancePath], [...prefix, "--allow-fs-read=*", "tests/a.test.ts"], [...prefix, "", "tests/a.test.ts"]]) {
    const harness = boundaries(command);
    const result = await harness.actual.graphDerivedCheck("/never-read", "unused-candidate", validationId, false);
    const expected = inspectCheckCommand(command);
    assert.equal(expected.status, "invalid");
    assert.equal(result.status, "refused");
    assert.equal(result.reasonCode, "CHECK_COMMAND_CONTRACT_INVALID");
    assert.deepEqual(result.commandContract, expected);
    if (expected.status === "invalid") assert.equal(result.diagnosticDetails?.detail, expected.detail);
    assert.equal(result.confinementFailure, undefined);
    assert.deepEqual(harness.counts(), { hostProbes: 0, policyReads: 0, launcherProbes: 0 });
  }
});

test("valid graph commands still require the original host authority guard", async () => {
  const harness = boundaries(validCommands[0]!);
  const result = await harness.actual.graphDerivedCheck("/never-read", "unused-candidate", validationId, false);
  assert.equal(result.status, "refused");
  assert.equal(result.reasonCode, "CHECK_CONFINEMENT_UNAVAILABLE");
  assert.equal(result.confinementFailure, "HOST_PROFILE_AUTHORITY_READ_FAILED");
  assert.equal(result.commandContract, undefined);
  assert.deepEqual(harness.counts(), { hostProbes: 1, policyReads: 1, launcherProbes: 0 });
});
