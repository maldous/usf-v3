import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resourceDigest, type SemanticGraph } from "../../../src/graph/index.ts";
import { canonicalQuadDigest, parseStrictNQuads } from "../../../src/graph/nquads.ts";
import { authenticateFixtureProcessHostProfile, confinedFixtureProcessLaunch, fixtureProcessLaunchArguments, readFixtureProcessPolicy, validateFixtureProcessHostProfileMetadata } from "../../../src/realisation/fixture-process.ts";

const MODE_IRI = "urn:usf:mode:confined-fixture-process:1";
const NATIVE_MODE_IRI = "urn:usf:mode:confined-fixture-process:2";
const MODE = `<${MODE_IRI}>`;
const NATIVE_MODE = `<${NATIVE_MODE_IRI}>`;
const GRAPH = "<urn:usf:graph:fixture-process-validation>";
const NODE_DIGEST = "sha256:b2959781cc5a74c357ffa02367efa8a0330cbb1c9cb347732fdfaaaca381cbcd";
const GIT_DIGEST = "sha256:2a8c18fbf43da9f692d75474c72bea9dfd796c260b0f3dfe456376abc3bbd668";
const FLOCK_DIGEST = "sha256:e619344dc3eec4023498465679262f9ca27d1e8cef9cfc4c1ae72b428577b806";
const INTERPRETER_DIGEST = "sha256:1643dacd9feaedc58f3cc581e4d22577dfe25c09b10282936186ccf0f2e61118";
const PROFILE_ASSET_DIGEST = "sha256:1111111111111111111111111111111111111111111111111111111111111111";
const PROFILE_KERNEL_RAW_DIGEST = "sha256:2222222222222222222222222222222222222222222222222222222222222222";
const NON_CLAIM =
  "Declared proposed mode only. No current validation selects it in this Stage A scope; implementation and subsequent explicit Stage B selection are required.";

const line = (subject: string, predicate: string, object: string): string =>
  `${subject} <urn:usf:predicate:${predicate}> ${object} ${GRAPH} .`;
const tool = (name: string, path: string, digest: string): string[] => [
  line(`<urn:usf:host-tool:fixture-${name}:1>`, "executableDigest", `"${digest}"`),
  line(`<urn:usf:host-tool:fixture-${name}:1>`, "executablePath", `"${path}"`),
  line(`<urn:usf:host-tool:fixture-${name}:1>`, "type", "<urn:usf:type:HostToolDependency>"),
  line(`<urn:usf:host-tool:fixture-${name}:1>`, "version", '"1"'),
];
const MODE_LINES: readonly string[] = [
  ...tool("flock", "/usr/bin/flock", FLOCK_DIGEST),
  ...tool("git", "/usr/bin/git", GIT_DIGEST),
  ...tool("node", "/usr/bin/node", NODE_DIGEST),
  line(MODE, "confinementStrategy", '"bwrap-apparmor-execute-v1"'),
  line(MODE, "fixtureProfileName", '"usf-fixture-process-v1"'),
  line(MODE, "fixtureProfileAssetPath", '"src/realisation/fixture-process.apparmor"'),
  line(MODE, "fixtureProfileAssetDigest", `"${PROFILE_ASSET_DIGEST}"`),
  line(MODE, "fixtureProfileKernelRawDigest", `"${PROFILE_KERNEL_RAW_DIGEST}"`),
  line(MODE, "fixtureExecutable", "<urn:usf:host-tool:fixture-flock:1>"),
  line(MODE, "fixtureExecutable", "<urn:usf:host-tool:fixture-git:1>"),
  line(MODE, "fixtureExecutable", "<urn:usf:host-tool:fixture-node:1>"),
  line(MODE, "fixtureInterpreterDigest", `"${INTERPRETER_DIGEST}"`),
  line(MODE, "fixtureInterpreterPath", '"/usr/bin/python3.12"'),
  line(MODE, "fixtureLauncherPath", '"src/realisation/fixture-process-launcher.py"'),
  line(MODE, "nonClaim", `"${NON_CLAIM}"`),
  line(MODE, "type", "<urn:usf:type:ExecutionMode>"),
  line(MODE, "version", '"1"'),
];
const BASE_TEXT = `${MODE_LINES.join("\n")}\n`;
const NATIVE_MODE_LINES: readonly string[] = MODE_LINES.map((entry) =>
  entry.replaceAll(MODE, NATIVE_MODE)
).map((entry) =>
  entry === line(NATIVE_MODE, "version", '"1"')
    ? line(NATIVE_MODE, "version", '"2"')
    : entry
);
const NATIVE_BASE_TEXT = `${NATIVE_MODE_LINES.join("\n")}\n`;

const graphFromText = (text: string): SemanticGraph => {
  const quads = parseStrictNQuads(text, "urn:usf:graph:fixture-process-validation");
  return {
    manifest: { schema: "urn:usf:graph-manifest:2", version: 2, imports: [], sources: [] },
    quads,
    semanticDigest: canonicalQuadDigest(quads),
    graphDigests: {},
    sourceDigests: {},
    repositoryRoot: "/fixture",
  };
};
const dropLine = (needle: string): string => {
  const kept = MODE_LINES.filter((entry) => entry !== needle);
  assert.equal(kept.length, MODE_LINES.length - 1, `fixture line to drop must exist: ${needle}`);
  return `${kept.join("\n")}\n`;
};
const swapLine = (from: string, to: string): string => {
  assert.ok(MODE_LINES.includes(from), `fixture line to swap must exist: ${from}`);
  return `${MODE_LINES.map((entry) => (entry === from ? to : entry)).join("\n")}\n`;
};
const appendLine = (extra: string): string => `${BASE_TEXT}${extra}\n`;
const loadPolicy = () => {
  const policy = readFixtureProcessPolicy(graphFromText(BASE_TEXT), MODE_IRI);
  assert.ok(policy, "the unmodified fixture mode must parse to a policy");
  return policy;
};
const loadNativePolicy = () => {
  const policy = readFixtureProcessPolicy(
    graphFromText(NATIVE_BASE_TEXT),
    NATIVE_MODE_IRI
  );
  assert.ok(policy, "the native fixture mode must parse to a policy");
  return policy;
};

test("readFixtureProcessPolicy accepts the declared mode and ignores unrelated modes", () => {
  const graph = graphFromText(BASE_TEXT);
  assert.notEqual(readFixtureProcessPolicy(graph, MODE_IRI), null);
  assert.equal(readFixtureProcessPolicy(graph, "urn:usf:mode:unrelated-fixture-process:1"), null);
});

test("readFixtureProcessPolicy selects only the exact native mode version", () => {
  const graph = graphFromText(NATIVE_BASE_TEXT);
  const policy = readFixtureProcessPolicy(graph, NATIVE_MODE_IRI);
  assert.ok(policy);
  assert.equal(policy.modeIri, NATIVE_MODE_IRI);
  assert.equal(readFixtureProcessPolicy(graph, MODE_IRI), null);
  const wrongVersion = NATIVE_BASE_TEXT.replace(
    line(NATIVE_MODE, "version", '"2"'),
    line(NATIVE_MODE, "version", '"1"')
  );
  assert.equal(
    readFixtureProcessPolicy(graphFromText(wrongVersion), NATIVE_MODE_IRI),
    null
  );
});

test("parseStrictNQuads refuses a duplicate canonical N-Quad line", () => {
  const duplicate = line(MODE, "fixtureExecutable", "<urn:usf:host-tool:fixture-git:1>");
  assert.throws(
    () => parseStrictNQuads(`${BASE_TEXT}${duplicate}\n`, "urn:usf:graph:fixture-process-validation"),
    (error: unknown) => error instanceof Error && error.message === "NQUADS_DUPLICATE_QUAD",
  );
});

test("readFixtureProcessPolicy refuses a duplicate executable reference forged after strict parsing", () => {
  const parsedGraph = graphFromText(BASE_TEXT);
  const [duplicateExecutableQuad] = parseStrictNQuads(
    `${line(MODE, "fixtureExecutable", "<urn:usf:host-tool:fixture-git:1>")}\n`,
    "urn:usf:graph:fixture-process-validation",
  );
  assert.ok(duplicateExecutableQuad, "the duplicate executable fixture quad must parse");
  const forgedGraph: SemanticGraph = {
    ...parsedGraph,
    quads: [...parsedGraph.quads, duplicateExecutableQuad],
  };
  assert.equal(readFixtureProcessPolicy(forgedGraph, MODE_IRI), null);
});

test("readFixtureProcessPolicy declares tool dependencies by semantic identity, distinct from raw binary digests", () => {
  const graph = graphFromText(BASE_TEXT);
  const policy = readFixtureProcessPolicy(graph, MODE_IRI);
  assert.ok(policy, "the unmodified fixture mode must parse to a policy");
  assert.deepEqual(policy.toolDependencies, [
    { kind: "host-tool", id: "urn:usf:host-tool:fixture-node:1", digest: resourceDigest(graph, "urn:usf:host-tool:fixture-node:1") },
    { kind: "host-tool", id: "urn:usf:host-tool:fixture-git:1", digest: resourceDigest(graph, "urn:usf:host-tool:fixture-git:1") },
    { kind: "host-tool", id: "urn:usf:host-tool:fixture-flock:1", digest: resourceDigest(graph, "urn:usf:host-tool:fixture-flock:1") },
  ], "tool dependencies carry graph resource digests in node/git/flock order");
  for (const dependency of policy.toolDependencies) {
    assert.ok(![NODE_DIGEST, GIT_DIGEST, FLOCK_DIGEST].includes(dependency.digest), "semantic tool digests must not collapse into raw binary digests");
  }
});

const parserRefusals: readonly (readonly [string, string])[] = [
  ["a missing flock executable reference", dropLine(line(MODE, "fixtureExecutable", "<urn:usf:host-tool:fixture-flock:1>"))],
  ["a reference to an undeclared executable", swapLine(line(MODE, "fixtureExecutable", "<urn:usf:host-tool:fixture-git:1>"), line(MODE, "fixtureExecutable", "<urn:usf:host-tool:fixture-shell:1>"))],
  ["an excess fourth executable reference", appendLine(line(MODE, "fixtureExecutable", "<urn:usf:host-tool:fixture-node:2>"))],
  ["a literal where an executable IRI is required", swapLine(line(MODE, "fixtureExecutable", "<urn:usf:host-tool:fixture-node:1>"), line(MODE, "fixtureExecutable", '"urn:usf:host-tool:fixture-node:1"'))],
  ["an unsupported mode version", swapLine(line(MODE, "version", '"1"'), line(MODE, "version", '"2"'))],
  ["a conflicting duplicate interpreter path", appendLine(line(MODE, "fixtureInterpreterPath", '"/usr/bin/python3.11"'))],
  ["a missing profile name", dropLine(line(MODE, "fixtureProfileName", '"usf-fixture-process-v1"'))],
  ["an unknown profile name", swapLine(line(MODE, "fixtureProfileName", '"usf-fixture-process-v1"'), line(MODE, "fixtureProfileName", '"unknown-profile"'))],
  ["a duplicate profile name", appendLine(line(MODE, "fixtureProfileName", '"unknown-profile"'))],
  ["a missing profile asset path", dropLine(line(MODE, "fixtureProfileAssetPath", '"src/realisation/fixture-process.apparmor"'))],
  ["an unknown profile asset path", swapLine(line(MODE, "fixtureProfileAssetPath", '"src/realisation/fixture-process.apparmor"'), line(MODE, "fixtureProfileAssetPath", '"src/realisation/unknown.apparmor"'))],
  ["a zero profile asset digest", swapLine(line(MODE, "fixtureProfileAssetDigest", `"${PROFILE_ASSET_DIGEST}"`), line(MODE, "fixtureProfileAssetDigest", `"sha256:${"0".repeat(64)}"`))],
  ["a zero kernel raw digest", swapLine(line(MODE, "fixtureProfileKernelRawDigest", `"${PROFILE_KERNEL_RAW_DIGEST}"`), line(MODE, "fixtureProfileKernelRawDigest", `"sha256:${"0".repeat(64)}"`))],
  ["a relative interpreter path", swapLine(line(MODE, "fixtureInterpreterPath", '"/usr/bin/python3.12"'), line(MODE, "fixtureInterpreterPath", '"usr/bin/python3.12"'))],
  ["a malformed interpreter digest", swapLine(line(MODE, "fixtureInterpreterDigest", `"${INTERPRETER_DIGEST}"`), line(MODE, "fixtureInterpreterDigest", '"sha256:zz59"'))],
  ["a launcher path escaping the workspace", swapLine(line(MODE, "fixtureLauncherPath", '"src/realisation/fixture-process-launcher.py"'), line(MODE, "fixtureLauncherPath", '"../fixture-process-launcher.py"'))],
  ["an unsupported digest kind on the node executable", swapLine(line("<urn:usf:host-tool:fixture-node:1>", "executableDigest", `"${NODE_DIGEST}"`), line("<urn:usf:host-tool:fixture-node:1>", "executableDigest", `"sha1:${NODE_DIGEST.slice(7, 47)}"`))],
  ["a missing raw digest on the node executable", dropLine(line("<urn:usf:host-tool:fixture-node:1>", "executableDigest", `"${NODE_DIGEST}"`))],
  ["a conflicting duplicate raw digest on the node executable", appendLine(line("<urn:usf:host-tool:fixture-node:1>", "executableDigest", `"${FLOCK_DIGEST}"`))],
  ["a missing mode type declaration", dropLine(line(MODE, "type", "<urn:usf:type:ExecutionMode>"))],
  ["an unknown mode type IRI", swapLine(line(MODE, "type", "<urn:usf:type:ExecutionMode>"), line(MODE, "type", "<urn:usf:type:UnknownMode>"))],
  ["a missing mode version", dropLine(line(MODE, "version", '"1"'))],
  ["two executables declaring the same path", swapLine(line("<urn:usf:host-tool:fixture-git:1>", "executablePath", '"/usr/bin/git"'), line("<urn:usf:host-tool:fixture-git:1>", "executablePath", '"/usr/bin/node"'))],
  ...(["node", "git", "flock"] as const).flatMap((name): (readonly [string, string])[] => {
    const subject = `<urn:usf:host-tool:fixture-${name}:1>`;
    return [
      [`a missing type on the ${name} executable`, dropLine(line(subject, "type", "<urn:usf:type:HostToolDependency>"))],
      [`an unknown type IRI on the ${name} executable`, swapLine(line(subject, "type", "<urn:usf:type:HostToolDependency>"), line(subject, "type", "<urn:usf:type:UnknownTool>"))],
      [`a missing version on the ${name} executable`, dropLine(line(subject, "version", '"1"'))],
      [`an unsupported version on the ${name} executable`, swapLine(line(subject, "version", '"1"'), line(subject, "version", '"2"'))],
    ];
  }),
];
for (const [label, text] of parserRefusals) {
  test(`readFixtureProcessPolicy refuses ${label}`, () => {
    assert.equal(readFixtureProcessPolicy(graphFromText(text), MODE_IRI), null);
  });
}

const WORKSPACE = "/fixture";
const DEPS = "/fixture/deps";
const CACHE = "/fixture/cache";
const SCRATCH = "/fixture/.usf/tmp/check";
const TEST_PATH = "tests/unit/realisation/fixture-process.test.ts";
const environment: readonly (readonly [string, string])[] = [
  ["HOME", "/fixture/.usf-empty-home"],
  ["LANG", "C.UTF-8"],
  ["LC_ALL", "C.UTF-8"],
  ["NODE_PATH", DEPS],
  ["PATH", ""],
  ["TMPDIR", SCRATCH],
  ["USF_BWRAP_NETWORK", "isolated"],
  ["USF_PROVIDER_HOME", "/fixture/.usf/provider-home"],
  ["USF_REPOSITORY_ROOT", WORKSPACE],
];
const nodeArguments: readonly string[] = [
  "--permission",
  `--allow-fs-read=${WORKSPACE}`,
  `--allow-fs-read=${DEPS}`,
  `--allow-fs-read=${CACHE}`,
  "--allow-fs-read=/etc/passwd",
  "--allow-fs-read=/proc/net/route",
  `--allow-fs-write=${SCRATCH}`,
  "--test",
  "--test-isolation=none",
  TEST_PATH,
];
const expectedPayloadNodeArguments: readonly string[] = [
  "--permission",
  "--allow-child-process",
  ...nodeArguments.slice(nodeArguments.indexOf("--permission") + 1, nodeArguments.indexOf("--test")),
  "--allow-fs-read=/proc",
  "--allow-fs-read=/usr/bin",
  ...nodeArguments.slice(nodeArguments.indexOf("--test")),
];
const baseArguments: readonly string[] = [
  "--unshare-user", "--unshare-pid", "--unshare-net", "--die-with-parent",
  "--tmpfs", "/",
  ...["/usr", "/lib", "/lib64", WORKSPACE, DEPS, CACHE].flatMap((path) => ["--ro-bind", path, path]),
  "--ro-bind", DEPS, `${WORKSPACE}/node_modules`,
  "--ro-bind", CACHE, `${WORKSPACE}/.usf/cache`,
  "--proc", "/proc", "--dev", "/dev",
  "--bind", SCRATCH, SCRATCH,
  "--chdir", WORKSPACE, "--clearenv",
  ...environment.flatMap(([name, value]) => ["--setenv", name, value]),
  "--", "/usr/bin/node", ...nodeArguments,
];
type BaseLaunch = { executable: string; arguments: readonly string[] };
const baseLaunch = (): BaseLaunch => ({ executable: "/usr/bin/bwrap", arguments: [...baseArguments] });

test("fixtureProcessLaunchArguments preserves confinement and delegates through the authenticated launcher", () => {
  const base = baseLaunch();
  const snapshot = structuredClone(base);
  const launch = fixtureProcessLaunchArguments(base, loadPolicy(), WORKSPACE);
  assert.ok(launch, "the current base launch must be accepted");
  assert.deepEqual(base, snapshot, "the base launch object must not be mutated");
  assert.equal(launch.executable, "/usr/bin/bwrap");
  const produced = [...launch.arguments];
  assert.equal(produced.filter((value) => value === "--").length, 1, "exactly one argument separator");
  const separator = produced.indexOf("--");
  const prefix = produced.slice(0, separator);
  const expectedPrefix = [...baseArguments.slice(0, baseArguments.indexOf("--"))];
  expectedPrefix[expectedPrefix.indexOf("PATH") + 1] = "/usr/bin";
  assert.deepEqual(prefix, expectedPrefix, "the complete bwrap prefix matches the base exactly, with only the PATH value changed so the launcher interpreter resolves");
  const tail = produced.slice(separator + 1);
  assert.deepEqual(tail.slice(0, 6), ["/usr/bin/python3.12", "-I", "-S", "-B", "/fixture/src/realisation/fixture-process-launcher.py", "--fixture-process-v2"]);
  assert.equal(tail.length, 7, "the launcher receives exactly one JSON payload argument");
  const payload: unknown = JSON.parse(tail[6]);
  assert.deepEqual(payload, {
    version: 2,
    apparmorProfile: "usf-fixture-process-v1",
    executables: [
      { path: "/usr/bin/node", digest: NODE_DIGEST },
      { path: "/usr/bin/git", digest: GIT_DIGEST },
      { path: "/usr/bin/flock", digest: FLOCK_DIGEST },
    ],
    nodeArguments: [...expectedPayloadNodeArguments],
  }, "the payload carries exactly the v2 protocol, AppArmor profile, raw-pinned node/git/flock executables, and node arguments");
});

test("fixtureProcessLaunchArguments derives the exact native wire3 interface from the authenticated base launch", () => {
  const base = baseLaunch();
  const snapshot = structuredClone(base);
  const launch = fixtureProcessLaunchArguments(
    base,
    loadNativePolicy(),
    WORKSPACE
  );
  assert.ok(launch);
  assert.deepEqual(base, snapshot, "native derivation does not mutate the authenticated base");
  assert.equal(launch.executable, "/usr/bin/bwrap");
  const produced = [...launch.arguments];
  const separator = produced.indexOf("--");
  const expectedPrefix = [...baseArguments.slice(0, baseArguments.indexOf("--"))];
  expectedPrefix[expectedPrefix.indexOf("PATH") + 1] = "/usr/bin";
  assert.deepEqual(produced.slice(0, separator), expectedPrefix);
  const tail = produced.slice(separator + 1);
  assert.deepEqual(tail.slice(0, 6), [
    "/usr/bin/python3.12",
    "-I",
    "-S",
    "-B",
    "/fixture/src/realisation/fixture-process-launcher.py",
    "--fixture-process-v2",
  ]);
  assert.equal(tail.length, 7);
  const payload: unknown = JSON.parse(tail[6]);
  assert.deepEqual(payload, {
    version: 3,
    executionMode: NATIVE_MODE_IRI,
    apparmorProfile: "usf-fixture-process-v1",
    executables: [
      { path: "/usr/bin/node", digest: NODE_DIGEST },
      { path: "/usr/bin/git", digest: GIT_DIGEST },
      { path: "/usr/bin/flock", digest: FLOCK_DIGEST },
    ],
    filesystemReadPaths: [
      WORKSPACE,
      DEPS,
      CACHE,
      "/etc/passwd",
      "/proc/net/route",
      "/proc",
      "/usr/bin",
    ],
    filesystemWritePath: SCRATCH,
    nodeArguments: ["--no-addons", "--test", "--test-isolation=none", TEST_PATH],
  });
  assert.deepEqual(Object.keys(payload as object), [
    "version",
    "executionMode",
    "apparmorProfile",
    "executables",
    "filesystemReadPaths",
    "filesystemWritePath",
    "nodeArguments",
  ], "wire3 has exactly the seven documented keys in producer order");
  const nativeArguments = (payload as { nodeArguments: string[] }).nodeArguments;
  assert.equal(nativeArguments.some((argument) => argument === "--permission" || argument.startsWith("--allow-")), false);
});

const mutated = (mutate: (values: string[]) => void): BaseLaunch => {
  const values = [...baseArguments];
  mutate(values);
  return { executable: "/usr/bin/bwrap", arguments: values };
};
const removeAt = (values: string[], flag: string, count = 1): void => {
  const index = values.indexOf(flag);
  assert.ok(index >= 0, `flag to remove must exist: ${flag}`);
  values.splice(index, count);
};
const beforeTest = (values: string[], ...extra: string[]): void => {
  values.splice(values.indexOf("--test"), 0, ...extra);
};
const builderRefusals: readonly (readonly [string, BaseLaunch])[] = [
  ["a bare bwrap invocation without confinement", { executable: "/usr/bin/bwrap", arguments: ["--", "/usr/bin/node", ...nodeArguments] }],
  ["missing network isolation", mutated((values) => removeAt(values, "--unshare-net"))],
  ["a missing --clearenv", mutated((values) => removeAt(values, "--clearenv"))],
  ["a missing /proc mount", mutated((values) => removeAt(values, "--proc", 2))],
  ["a duplicate argument separator", mutated((values) => values.splice(values.indexOf("--"), 0, "--"))],
  ["child processes already allowed in the base launch", mutated((values) => beforeTest(values, "--allow-child-process"))],
  ["an --eval escape", mutated((values) => beforeTest(values, "--eval", "process.exit(0)"))],
  ["a network permission grant", mutated((values) => beforeTest(values, "--allow-net"))],
  ["a missing --permission flag", mutated((values) => removeAt(values, "--permission"))],
  ["an unknown node flag", mutated((values) => beforeTest(values, "--inspect"))],
  ["an excess write grant", mutated((values) => beforeTest(values, `--allow-fs-write=${WORKSPACE}`))],
  ["a duplicate write grant", mutated((values) => beforeTest(values, `--allow-fs-write=${SCRATCH}`))],
  ["comma injection in a read grant", mutated((values) => { values[values.indexOf(`--allow-fs-read=${DEPS}`)] = `--allow-fs-read=${DEPS},/etc`; })],
  ["glob injection in a read grant", mutated((values) => { values[values.indexOf(`--allow-fs-read=${WORKSPACE}`)] = `--allow-fs-read=${WORKSPACE}/*`; })],
  ["a NUL byte in the test path", mutated((values) => { values[values.indexOf(TEST_PATH)] = `${TEST_PATH}\u0000.js`; })],
  ["an absolute test path outside the workspace", mutated((values) => { values[values.indexOf(TEST_PATH)] = "/etc/passwd"; })],
];
for (const [label, base] of builderRefusals) {
  test(`fixtureProcessLaunchArguments refuses ${label}`, () => {
    assert.equal(fixtureProcessLaunchArguments(base, loadPolicy(), WORKSPACE), null);
  });
}
test("fixtureProcessLaunchArguments refuses workspaces that do not match the confined launch", () => {
  assert.equal(fixtureProcessLaunchArguments(baseLaunch(), loadPolicy(), "fixture"), null, "relative workspace");
  assert.equal(fixtureProcessLaunchArguments(baseLaunch(), loadPolicy(), "/elsewhere"), null, "unrelated absolute workspace");
});

test("fixtureProcessLaunchArguments requires the strict permission-bearing base before native derivation", () => {
  const withoutPermission = mutated((values) => removeAt(values, "--permission"));
  assert.equal(
    fixtureProcessLaunchArguments(withoutPermission, loadNativePolicy(), WORKSPACE),
    null
  );
});

test("fixtureProcessLaunchArguments refuses arbitrary mode fallback", () => {
  const policy = structuredClone(loadNativePolicy());
  policy.modeIri = "urn:usf:mode:confined-fixture-process:3";
  assert.equal(fixtureProcessLaunchArguments(baseLaunch(), policy, WORKSPACE), null);
});

const hardeningRefusals: readonly (readonly [string, BaseLaunch])[] = [
  ["an extra ro-bind beyond the base mounts and dependency aliases", mutated((values) => values.splice(values.indexOf("--proc"), 0, "--ro-bind", "/etc", "/etc"))],
  ["a duplicate base ro-bind mount", mutated((values) => values.splice(values.indexOf("--proc"), 0, "--ro-bind", "/usr", "/usr"))],
  ["cross-destination dependency aliases", mutated((values) => { const nodeModules = values.indexOf(`${WORKSPACE}/node_modules`); const cache = values.indexOf(`${WORKSPACE}/.usf/cache`); values[nodeModules] = `${WORKSPACE}/.usf/cache`; values[cache] = `${WORKSPACE}/node_modules`; })],
  ["a dependency alias whose source is not the matching root", mutated((values) => { values[values.indexOf(`${WORKSPACE}/node_modules`) - 1] = WORKSPACE; })],
  ["a scratch bind that diverges from the write grant and TMPDIR", mutated((values) => { const bind = values.indexOf("--bind"); values[bind + 1] = `${WORKSPACE}/.usf/tmp/other`; values[bind + 2] = `${WORKSPACE}/.usf/tmp/other`; })],
  ["a write grant that diverges from the scratch bind", mutated((values) => { values[values.indexOf(`--allow-fs-write=${SCRATCH}`)] = `--allow-fs-write=${WORKSPACE}/.usf/tmp/other`; })],
  ["a TMPDIR that diverges from the scratch bind", mutated((values) => { values[values.indexOf("TMPDIR") + 1] = `${WORKSPACE}/.usf/tmp/other`; })],
  ["a scratch bind of the workspace itself", mutated((values) => { const bind = values.indexOf("--bind"); values[bind + 1] = WORKSPACE; values[bind + 2] = WORKSPACE; })],
  ["a NODE_PATH that diverges from the first dependency root", mutated((values) => { values[values.indexOf("NODE_PATH") + 1] = CACHE; })],
  ["read grants outside the fixed grammar order", mutated((values) => { const workspaceRead = values.indexOf(`--allow-fs-read=${WORKSPACE}`); const passwdRead = values.indexOf("--allow-fs-read=/etc/passwd"); values[workspaceRead] = "--allow-fs-read=/etc/passwd"; values[passwdRead] = `--allow-fs-read=${WORKSPACE}`; })],
  ["a missing second dependency-root read grant", mutated((values) => removeAt(values, `--allow-fs-read=${CACHE}`))],
];
for (const [label, base] of hardeningRefusals) {
  test(`fixtureProcessLaunchArguments refuses ${label}`, () => {
    assert.equal(fixtureProcessLaunchArguments(base, loadPolicy(), WORKSPACE), null);
  });
}

type ForgeableDependencies = {
  toolDependencies: Array<{ kind: string; id: string; digest: string }>;
  fixtureExecutables: ReadonlyArray<{ rawDigest: string; resourceDigest: string }>;
};
const forgedPolicy = (mutate: (policy: ForgeableDependencies) => void): ReturnType<typeof loadPolicy> => {
  const policy = structuredClone(loadPolicy());
  mutate(policy as unknown as ForgeableDependencies);
  return policy;
};
test("authenticateFixtureProcessHostProfile fails closed without matching kernel metadata", () => {
  assert.equal(authenticateFixtureProcessHostProfile(loadPolicy()), false);
});

test("host profile metadata accepts a profile.entry index distinct from its raw-data index and normalizes bare sha256", () => {
  const policy = loadPolicy();
  assert.equal(validateFixtureProcessHostProfileMetadata(policy, [{
    entryName: "usf-fixture-process-v1.17",
    profileName: "usf-fixture-process-v1",
    mode: "enforce",
    rawLink: "../../raw_data/902/sha256",
    rawDigest: PROFILE_KERNEL_RAW_DIGEST.slice("sha256:".length),
  }]), true);
});

test("host profile metadata refuses zero, multiple, malformed, absent, unknown, and different matches", () => {
  const policy = loadPolicy();
  const valid = {
    entryName: "usf-fixture-process-v1.17",
    profileName: "usf-fixture-process-v1",
    mode: "enforce",
    rawLink: "../../raw_data/902/sha256",
    rawDigest: PROFILE_KERNEL_RAW_DIGEST,
  };
  assert.equal(validateFixtureProcessHostProfileMetadata(policy, []), false, "zero matches");
  assert.equal(validateFixtureProcessHostProfileMetadata(policy, [valid, { ...valid, entryName: "usf-fixture-process-v1.18" }]), false, "multiple matches");
  assert.equal(validateFixtureProcessHostProfileMetadata(policy, [{ ...valid, entryName: "17" }]), false, "bare numeric entry");
  assert.equal(validateFixtureProcessHostProfileMetadata(policy, [{ ...valid, rawLink: "../../raw_data/17/not-sha256" }]), false, "malformed link");
  assert.equal(validateFixtureProcessHostProfileMetadata(policy, [{ ...valid, rawDigest: null }]), false, "absent digest");
  assert.equal(validateFixtureProcessHostProfileMetadata(policy, [{ ...valid, rawDigest: "unknown" }]), false, "unknown digest");
  assert.equal(validateFixtureProcessHostProfileMetadata(policy, [{ ...valid, rawDigest: "sha256:" + "0".repeat(64) }]), false, "zero digest");
  assert.equal(validateFixtureProcessHostProfileMetadata(policy, [{ ...valid, rawDigest: "sha256:" + "3".repeat(64) }]), false, "different digest");
});

test("confinedFixtureProcessLaunch refuses a missing host profile without executing Python", () => {
  const refused = confinedFixtureProcessLaunch(
    baseLaunch(),
    loadPolicy(),
    WORKSPACE
  );
  assert.equal(refused, null);
});

test("fixture process AppArmor source permits only peer profile identity reads", () => {
  const profile = readFileSync(new URL("../../../src/realisation/fixture-process.apparmor", import.meta.url), "utf8");
  const ptraceRules = profile
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => /^ptrace\b/u.test(line));

  assert.deepEqual(ptraceRules, ["ptrace (read, readby) peer=\"bwrap//&unpriv_bwrap//&usf-fixture-process-v1\","]);
  assert.doesNotMatch(profile, /^\s*ptrace\s*,/mu, "unqualified ptrace is forbidden");
  assert.doesNotMatch(profile, /^\s*ptrace\b[^\n]*\b(?:trace|tracedby)\b/mu, "trace directions are forbidden");
  assert.doesNotMatch(profile, /^\s*ptrace\b[^\n]*peer\s*=\s*"?(?:\*|unconfined|bwrap|unpriv_bwrap|@\{profile_name\})"?\s*,\s*$/mu, "bare, wildcard, or private-component-only peer scopes are forbidden");
  assert.doesNotMatch(profile, /^\s*capability\s+sys_ptrace\b/mu, "sys_ptrace is forbidden");
});

test("fixtureProcessLaunchArguments remains a pure default-mode-neutral builder", () => {
  let hostCalls = 0;
  assert.notEqual(fixtureProcessLaunchArguments(baseLaunch(), loadPolicy(), WORKSPACE), null);
  assert.equal(hostCalls, 0, "the unselected pure builder does not consult host policy");
});

test("fixtureProcessLaunchArguments refuses conflated repository and kernel profile digests", () => {
  const policy = structuredClone(loadPolicy());
  policy.fixtureProfileKernelRawDigest = policy.fixtureProfileAssetDigest;
  assert.notEqual(policy.fixtureProfileAssetDigest, PROFILE_KERNEL_RAW_DIGEST);
  assert.notEqual(fixtureProcessLaunchArguments(baseLaunch(), policy, WORKSPACE), null, "the separate commitments may coincidentally contain equal values without being compared to each other");
});

test("fixtureProcessLaunchArguments refuses tool dependencies that diverge from the pinned fixture executables", () => {
  const rawPinned = forgedPolicy((policy) => { policy.toolDependencies[0].digest = policy.fixtureExecutables[0].rawDigest; });
  assert.equal(fixtureProcessLaunchArguments(baseLaunch(), rawPinned, WORKSPACE), null, "a raw byte digest in place of the resource digest");
  const reordered = forgedPolicy((policy) => { policy.toolDependencies.reverse(); });
  assert.equal(fixtureProcessLaunchArguments(baseLaunch(), reordered, WORKSPACE), null, "reordered tool dependencies");
  const truncated = forgedPolicy((policy) => { policy.toolDependencies.pop(); });
  assert.equal(fixtureProcessLaunchArguments(baseLaunch(), truncated, WORKSPACE), null, "a missing tool dependency");
  const duplicated = forgedPolicy((policy) => { policy.toolDependencies[2] = { ...policy.toolDependencies[0] }; });
  assert.equal(fixtureProcessLaunchArguments(baseLaunch(), duplicated, WORKSPACE), null, "a duplicated tool dependency displacing another");
  const surplus = forgedPolicy((policy) => { policy.toolDependencies.push({ ...policy.toolDependencies[0] }); });
  assert.equal(fixtureProcessLaunchArguments(baseLaunch(), surplus, WORKSPACE), null, "a surplus tool dependency");
});
