import {
  lstatSync,
  realpathSync,
  openSync,
  fstatSync,
  readSync,
  closeSync,
  constants,
  readdirSync,
  readlinkSync,
  type BigIntStats,
} from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { objectsFor, resourceDigest, type SemanticGraph } from "../graph/index.ts";
import type { Quad } from "../graph/nquads.ts";

const CANONICAL_SHA256 = /^sha256:[0-9a-f]{64}$/;
const PERMISSION_FIXTURE_PROCESS_MODE_IRI =
  "urn:usf:mode:confined-fixture-process:1";
const NATIVE_FIXTURE_PROCESS_MODE_IRI =
  "urn:usf:mode:confined-fixture-process:2";

export interface FixtureProcessPolicy {
  modeIri: string;
  confinementStrategy: string;
  fixtureProfileName: string;
  fixtureProfileAssetPath: string;
  fixtureProfileAssetDigest: string;
  fixtureProfileKernelRawDigest: string;
  fixtureExecutables: Array<{
    iri: string;
    path: string;
    rawDigest: string;
    resourceDigest: string;
  }>;
  toolDependencies: Array<{
    kind: "host-tool";
    id: string;
    digest: string;
  }>;
  fixtureInterpreterPath: string;
  fixtureInterpreterRawDigest: string;
  fixtureLauncherPath: string;
}

export interface Launch {
  executable: string;
  arguments: readonly string[];
}

export function readFixtureProcessPolicy(
  graph: SemanticGraph,
  modeIri: string
): FixtureProcessPolicy | null {
  const expectedVersion =
    modeIri === PERMISSION_FIXTURE_PROCESS_MODE_IRI
      ? "1"
      : modeIri === NATIVE_FIXTURE_PROCESS_MODE_IRI
        ? "2"
        : null;
  if (expectedVersion === null) {
    return null;
  }

  const singleObject = (
    subject: string,
    predicate: string,
    kind: Quad["objectKind"]
  ): string | null => {
    const quads = objectsFor(graph, subject, predicate);
    if (quads.length !== 1 || quads[0].objectKind !== kind) {
      return null;
    }
    return quads[0].object;
  };
  const singleLiteral = (subject: string, predicate: string) =>
    singleObject(subject, predicate, "literal");
  const singleIri = (subject: string, predicate: string) =>
    singleObject(subject, predicate, "iri");

  if (singleIri(modeIri, "urn:usf:predicate:type") !== "urn:usf:type:ExecutionMode") {
    return null;
  }
  if (singleLiteral(modeIri, "urn:usf:predicate:version") !== expectedVersion) {
    return null;
  }

  const confinementStrategy = singleLiteral(
    modeIri,
    "urn:usf:predicate:confinementStrategy"
  );
  if (confinementStrategy !== "bwrap-apparmor-execute-v1") {
    return null;
  }

  const fixtureProfileName = singleLiteral(
    modeIri,
    "urn:usf:predicate:fixtureProfileName"
  );
  if (fixtureProfileName !== "usf-fixture-process-v1") {
    return null;
  }
  const fixtureProfileAssetPath = singleLiteral(
    modeIri,
    "urn:usf:predicate:fixtureProfileAssetPath"
  );
  if (fixtureProfileAssetPath !== "src/realisation/fixture-process.apparmor") {
    return null;
  }
  const fixtureProfileAssetDigest = singleLiteral(
    modeIri,
    "urn:usf:predicate:fixtureProfileAssetDigest"
  );
  const fixtureProfileKernelRawDigest = singleLiteral(
    modeIri,
    "urn:usf:predicate:fixtureProfileKernelRawDigest"
  );
  if (
    fixtureProfileAssetDigest === null ||
    fixtureProfileKernelRawDigest === null ||
    !CANONICAL_SHA256.test(fixtureProfileAssetDigest) ||
    !CANONICAL_SHA256.test(fixtureProfileKernelRawDigest) ||
    fixtureProfileAssetDigest === "sha256:" + "0".repeat(64) ||
    fixtureProfileKernelRawDigest === "sha256:" + "0".repeat(64)
  ) {
    return null;
  }

  const fixtureInterpreterPath = singleLiteral(
    modeIri,
    "urn:usf:predicate:fixtureInterpreterPath"
  );
  if (fixtureInterpreterPath !== "/usr/bin/python3.12") {
    return null;
  }

  const fixtureInterpreterRawDigest = singleLiteral(
    modeIri,
    "urn:usf:predicate:fixtureInterpreterDigest"
  );
  if (
    fixtureInterpreterRawDigest === null ||
    !CANONICAL_SHA256.test(fixtureInterpreterRawDigest)
  ) {
    return null;
  }

  const fixtureLauncherPath = singleLiteral(
    modeIri,
    "urn:usf:predicate:fixtureLauncherPath"
  );
  if (fixtureLauncherPath !== "src/realisation/fixture-process-launcher.py") {
    return null;
  }

  const executableQuads = objectsFor(
    graph,
    modeIri,
    "urn:usf:predicate:fixtureExecutable"
  );
  if (
    executableQuads.length !== 3 ||
    executableQuads.some((quad) => quad.objectKind !== "iri")
  ) {
    return null;
  }
  const referencedIris = new Set(executableQuads.map((quad) => quad.object));

  const expectedTools = [
    { iri: "urn:usf:host-tool:fixture-node:1", path: "/usr/bin/node" },
    { iri: "urn:usf:host-tool:fixture-git:1", path: "/usr/bin/git" },
    { iri: "urn:usf:host-tool:fixture-flock:1", path: "/usr/bin/flock" },
  ] as const;
  if (
    referencedIris.size !== expectedTools.length ||
    expectedTools.some((tool) => !referencedIris.has(tool.iri))
  ) {
    return null;
  }

  const fixtureExecutables: FixtureProcessPolicy["fixtureExecutables"] = [];
  const toolDependencies: FixtureProcessPolicy["toolDependencies"] = [];

  for (const tool of expectedTools) {
    if (singleIri(tool.iri, "urn:usf:predicate:type") !== "urn:usf:type:HostToolDependency") {
      return null;
    }
    if (singleLiteral(tool.iri, "urn:usf:predicate:version") !== "1") {
      return null;
    }
    if (singleLiteral(tool.iri, "urn:usf:predicate:executablePath") !== tool.path) {
      return null;
    }

    const rawDigest = singleLiteral(tool.iri, "urn:usf:predicate:executableDigest");
    if (rawDigest === null || !CANONICAL_SHA256.test(rawDigest)) {
      return null;
    }

    const resDigest = resourceDigest(graph, tool.iri);
    if (!resDigest) {
      return null;
    }

    fixtureExecutables.push({
      iri: tool.iri,
      path: tool.path,
      rawDigest,
      resourceDigest: resDigest,
    });
    toolDependencies.push({ kind: "host-tool", id: tool.iri, digest: resDigest });
  }

  return {
    modeIri,
    confinementStrategy,
    fixtureProfileName,
    fixtureProfileAssetPath,
    fixtureProfileAssetDigest,
    fixtureProfileKernelRawDigest,
    fixtureExecutables,
    toolDependencies,
    fixtureInterpreterPath,
    fixtureInterpreterRawDigest,
    fixtureLauncherPath,
  };
}

const EXPECTED_MODE_IRIS: ReadonlySet<string> = new Set([
  PERMISSION_FIXTURE_PROCESS_MODE_IRI,
  NATIVE_FIXTURE_PROCESS_MODE_IRI,
]);
const EXPECTED_CONFINEMENT_STRATEGY = "bwrap-apparmor-execute-v1";
const EXPECTED_PROFILE_NAME = "usf-fixture-process-v1";
const EXPECTED_PROFILE_ASSET_RELATIVE_PATH =
  "src/realisation/fixture-process.apparmor";
const ZERO_SHA256 = "sha256:" + "0".repeat(64);
const APPARMOR_POLICY_PATH = "/sys/kernel/security/apparmor/policy";
const APPARMOR_PROFILES_PATH = APPARMOR_POLICY_PATH + "/profiles";
const MAX_APPARMOR_PROFILE_ENTRIES = 4096;
const APPARMOR_PROFILE_ENTRY = /^usf-fixture-process-v1\.([0-9]+)$/;
const APPARMOR_RAW_LINK = /^\.\.\/\.\.\/raw_data\/([0-9]+)\/sha256$/;

export interface FixtureProcessHostProfileMetadata {
  entryName: string;
  profileName: string | null;
  mode: string | null;
  rawLink: string | null;
  rawDigest: string | null;
}
const MAX_APPARMOR_METADATA_BYTES = 4096;
const EXPECTED_INTERPRETER_PATH = "/usr/bin/python3.12";
const EXPECTED_LAUNCHER_RELATIVE_PATH =
  "src/realisation/fixture-process-launcher.py";
const EXPECTED_FIXTURE_TOOLS: ReadonlyArray<{ iri: string; path: string }> = [
  { iri: "urn:usf:host-tool:fixture-node:1", path: "/usr/bin/node" },
  { iri: "urn:usf:host-tool:fixture-git:1", path: "/usr/bin/git" },
  { iri: "urn:usf:host-tool:fixture-flock:1", path: "/usr/bin/flock" },
];

// node:fs constants does not export O_CLOEXEC; this is the fixed Linux value,
// independently observed retained in /proc/self/fdinfo on this host.
const O_CLOEXEC_LINUX = 0x80000;
const UNSAFE_MODE_BITS = 0o6022n;
const EXEC_BITS = 0o111n;
const MAX_AUTHENTICATED_BYTES = 512n * 1024n * 1024n;
const READ_CHUNK_BYTES = 1024 * 1024;

export function authenticateFixtureProcessPolicy(
  policy: FixtureProcessPolicy,
  workspace: string
): boolean {
  try {
    if (process.platform !== "linux" || typeof process.getuid !== "function") {
      return false;
    }
    const currentUid = BigInt(process.getuid());

    if (!policyShapeIsAuthentic(policy)) {
      return false;
    }
    if (!workspacePathIsCanonical(workspace)) {
      return false;
    }
    if (!authenticateWorkspaceChain(workspace, currentUid)) {
      return false;
    }

    for (const tool of policy.fixtureExecutables) {
      if (!authenticateFile(tool.path, tool.rawDigest)) {
        return false;
      }
    }

    if (
      !authenticateFile(
        policy.fixtureInterpreterPath,
        policy.fixtureInterpreterRawDigest
      )
    ) {
      return false;
    }

    if (
      !authenticateWorkspaceFile(
        workspace,
        policy.fixtureProfileAssetPath,
        policy.fixtureProfileAssetDigest,
        currentUid
      )
    ) {
      return false;
    }

    if (
      !authenticateLauncher(workspace, policy.fixtureLauncherPath, currentUid)
    ) {
      return false;
    }

    return authenticateFixtureProcessHostProfile(policy);
  } catch {
    return false;
  }
}

function policyShapeIsAuthentic(policy: FixtureProcessPolicy): boolean {
  if (policy === null || typeof policy !== "object") {
    return false;
  }
  if (!EXPECTED_MODE_IRIS.has(policy.modeIri)) {
    return false;
  }
  if (policy.confinementStrategy !== EXPECTED_CONFINEMENT_STRATEGY) {
    return false;
  }
  if (policy.fixtureProfileName !== EXPECTED_PROFILE_NAME) {
    return false;
  }
  if (policy.fixtureProfileAssetPath !== EXPECTED_PROFILE_ASSET_RELATIVE_PATH) {
    return false;
  }
  if (
    !CANONICAL_SHA256.test(policy.fixtureProfileAssetDigest) ||
    !CANONICAL_SHA256.test(policy.fixtureProfileKernelRawDigest) ||
    policy.fixtureProfileAssetDigest === ZERO_SHA256 ||
    policy.fixtureProfileKernelRawDigest === ZERO_SHA256
  ) {
    return false;
  }
  if (policy.fixtureInterpreterPath !== EXPECTED_INTERPRETER_PATH) {
    return false;
  }
  if (!CANONICAL_SHA256.test(policy.fixtureInterpreterRawDigest)) {
    return false;
  }
  if (policy.fixtureLauncherPath !== EXPECTED_LAUNCHER_RELATIVE_PATH) {
    return false;
  }
  if (
    !Array.isArray(policy.fixtureExecutables) ||
    policy.fixtureExecutables.length !== EXPECTED_FIXTURE_TOOLS.length
  ) {
    return false;
  }
  for (let i = 0; i < EXPECTED_FIXTURE_TOOLS.length; i++) {
    const expected = EXPECTED_FIXTURE_TOOLS[i];
    const actual = policy.fixtureExecutables[i];
    if (actual === null || typeof actual !== "object") {
      return false;
    }
    if (actual.iri !== expected.iri || actual.path !== expected.path) {
      return false;
    }
    if (!CANONICAL_SHA256.test(actual.rawDigest)) {
      return false;
    }
    if (!CANONICAL_SHA256.test(actual.resourceDigest)) {
      return false;
    }
    // Raw byte digest and graph resource digest are separate commitments;
    // a policy that conflates them is forged or corrupt.
    if (actual.rawDigest === actual.resourceDigest) {
      return false;
    }
  }
  if (
    !Array.isArray(policy.toolDependencies) ||
    policy.toolDependencies.length !== EXPECTED_FIXTURE_TOOLS.length
  ) {
    return false;
  }
  for (let i = 0; i < EXPECTED_FIXTURE_TOOLS.length; i++) {
    const dependency = policy.toolDependencies[i];
    if (dependency === null || typeof dependency !== "object") {
      return false;
    }
    if (dependency.kind !== "host-tool") {
      return false;
    }
    if (dependency.id !== EXPECTED_FIXTURE_TOOLS[i].iri) {
      return false;
    }
    if (!CANONICAL_SHA256.test(dependency.digest)) {
      return false;
    }
    // Tool dependencies pin the graph resource commitment; the raw byte
    // digest belongs only to fixtureExecutables and is rejected here, and
    // fixtureExecutables[i] is already order-checked against the same tool.
    if (dependency.digest !== policy.fixtureExecutables[i].resourceDigest) {
      return false;
    }
  }
  return true;
}

function workspacePathIsCanonical(workspace: string): boolean {
  if (typeof workspace !== "string" || workspace.length === 0) {
    return false;
  }
  if (!workspace.startsWith("/")) {
    return false;
  }
  if (/[\0,*?\[\]{}]/.test(workspace)) {
    return false;
  }
  if (resolve(workspace) !== workspace) {
    return false;
  }
  const segments = workspace.split("/").slice(1);
  if (segments.length === 0) {
    return false;
  }
  for (const segment of segments) {
    if (segment.length === 0 || segment === "." || segment === "..") {
      return false;
    }
  }
  return true;
}

function authenticateWorkspaceChain(
  workspace: string,
  currentUid: bigint
): boolean {
  const segments = workspace.split("/").slice(1);
  if (!authenticateDirectory("/", [0n, currentUid])) {
    return false;
  }
  let current = "";
  for (let i = 0; i < segments.length; i++) {
    current = current + "/" + segments[i];
    const allowedUids =
      i === segments.length - 1 ? [currentUid] : [0n, currentUid];
    if (!authenticateDirectory(current, allowedUids)) {
      return false;
    }
  }
  return true;
}

function authenticateDirectory(
  path: string,
  allowedUids: readonly bigint[]
): boolean {
  const stat = lstatSync(path, { bigint: true });
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    return false;
  }
  if (realpathSync(path) !== path) {
    return false;
  }
  if (!allowedUids.includes(stat.uid)) {
    return false;
  }
  if ((stat.mode & UNSAFE_MODE_BITS) !== 0n) {
    return false;
  }
  return true;
}

function authenticateFile(path: string, expectedDigest: string): boolean {
  try {
    if (!CANONICAL_SHA256.test(expectedDigest)) {
      return false;
    }
    if (typeof path !== "string" || !path.startsWith("/usr/bin/")) {
      return false;
    }

    const stat = lstatSync(path, { bigint: true });
    if (stat.isSymbolicLink() || !stat.isFile()) {
      return false;
    }
    if (realpathSync(path) !== path) {
      return false;
    }
    if (stat.uid !== 0n || stat.nlink !== 1n) {
      return false;
    }
    if ((stat.mode & UNSAFE_MODE_BITS) !== 0n) {
      return false;
    }
    if ((stat.mode & EXEC_BITS) !== EXEC_BITS) {
      return false;
    }

    return hashOpenedFileMatches(path, stat, expectedDigest);
  } catch {
    return false;
  }
}

function hashOpenedFileMatches(
  path: string,
  pathStat: BigIntStats,
  expectedDigest: string
): boolean {
  const fd = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | O_CLOEXEC_LINUX
  );
  try {
    const opened = fstatSync(fd, { bigint: true });
    if (!statsMatch(opened, pathStat)) {
      return false;
    }
    if (opened.size > MAX_AUTHENTICATED_BYTES) {
      return false;
    }

    const total = Number(opened.size);
    const hash = createHash("sha256");
    const chunk = Buffer.alloc(Math.min(READ_CHUNK_BYTES, Math.max(total, 1)));
    let offset = 0;
    while (offset < total) {
      const wanted = Math.min(chunk.length, total - offset);
      const bytesRead = readSync(fd, chunk, 0, wanted, offset);
      if (bytesRead <= 0) {
        return false;
      }
      hash.update(chunk.subarray(0, bytesRead));
      offset += bytesRead;
    }
    if (offset !== total) {
      return false;
    }
    if (readSync(fd, chunk, 0, 1, offset) !== 0) {
      return false;
    }

    const after = fstatSync(fd, { bigint: true });
    if (!statsMatch(after, opened)) {
      return false;
    }

    return "sha256:" + hash.digest("hex") === expectedDigest;
  } finally {
    closeSync(fd);
  }
}

function statsMatch(a: BigIntStats, b: BigIntStats): boolean {
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.uid === b.uid &&
    a.nlink === b.nlink &&
    a.mode === b.mode &&
    a.size === b.size &&
    a.mtimeNs === b.mtimeNs &&
    a.ctimeNs === b.ctimeNs
  );
}

function authenticateWorkspaceFile(
  workspace: string,
  relativePath: string,
  expectedDigest: string,
  currentUid: bigint
): boolean {
  if (relativePath !== EXPECTED_PROFILE_ASSET_RELATIVE_PATH) {
    return false;
  }
  const absolutePath = resolve(workspace, relativePath);
  if (absolutePath !== workspace + "/" + relativePath) {
    return false;
  }
  const segments = relativePath.split("/");
  let current = workspace;
  for (let i = 0; i < segments.length - 1; i++) {
    current += "/" + segments[i];
    if (!authenticateDirectory(current, [currentUid])) {
      return false;
    }
  }
  const stat = lstatSync(absolutePath, { bigint: true });
  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    realpathSync(absolutePath) !== absolutePath ||
    stat.uid !== currentUid ||
    stat.nlink !== 1n ||
    (stat.mode & UNSAFE_MODE_BITS) !== 0n
  ) {
    return false;
  }
  return hashOpenedFileMatches(absolutePath, stat, expectedDigest);
}

function readBoundedVirtualText(path: string): string | null {
  const stat = lstatSync(path, { bigint: true });
  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    stat.uid !== 0n ||
    (stat.mode & 0o7777n) !== 0o444n
  ) {
    return null;
  }
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | O_CLOEXEC_LINUX);
  try {
    const opened = fstatSync(fd, { bigint: true });
    if (
      !opened.isFile() ||
      opened.dev !== stat.dev ||
      opened.ino !== stat.ino ||
      opened.uid !== stat.uid ||
      opened.mode !== stat.mode
    ) {
      return null;
    }
    const chunks: Buffer[] = [];
    let total = 0;
    const chunk = Buffer.alloc(256);
    for (;;) {
      const bytesRead = readSync(fd, chunk, 0, chunk.length, null);
      if (bytesRead === 0) {
        break;
      }
      total += bytesRead;
      if (total > MAX_APPARMOR_METADATA_BYTES) {
        return null;
      }
      chunks.push(Buffer.from(chunk.subarray(0, bytesRead)));
    }
    const after = fstatSync(fd, { bigint: true });
    if (
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      after.uid !== opened.uid ||
      after.mode !== opened.mode
    ) {
      return null;
    }
    return Buffer.concat(chunks).toString("utf8").trimEnd();
  } finally {
    closeSync(fd);
  }
}

function normalizeKernelSha256(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  if (/^[0-9a-f]{64}$/.test(value)) {
    return "sha256:" + value;
  }
  return CANONICAL_SHA256.test(value) ? value : null;
}

export function validateFixtureProcessHostProfileMetadata(
  policy: FixtureProcessPolicy,
  metadata: readonly FixtureProcessHostProfileMetadata[]
): boolean {
  if (!policyShapeIsAuthentic(policy)) {
    return false;
  }
  const matches = metadata.filter(
    (candidate) =>
      APPARMOR_PROFILE_ENTRY.test(candidate.entryName) &&
      candidate.profileName === policy.fixtureProfileName
  );
  if (matches.length !== 1) {
    return false;
  }
  const match = matches[0];
  if (match.mode !== "enforce" || match.rawLink === null) {
    return false;
  }
  const linkMatch = APPARMOR_RAW_LINK.exec(match.rawLink);
  if (linkMatch === null) {
    return false;
  }
  const normalized = normalizeKernelSha256(match.rawDigest);
  return normalized !== null && normalized !== ZERO_SHA256 &&
    normalized === policy.fixtureProfileKernelRawDigest;
}

export function authenticateFixtureProcessHostProfile(
  policy: FixtureProcessPolicy
): boolean {
  try {
    if (process.platform !== "linux" || !policyShapeIsAuthentic(policy)) {
      return false;
    }
    const entries = readdirSync(APPARMOR_PROFILES_PATH, { withFileTypes: true });
    if (entries.length > MAX_APPARMOR_PROFILE_ENTRIES) {
      return false;
    }
    const metadata: FixtureProcessHostProfileMetadata[] = [];
    for (const entry of entries) {
      const entryMatch = APPARMOR_PROFILE_ENTRY.exec(entry.name);
      if (entryMatch === null) {
        continue;
      }
      if (!entry.isDirectory()) {
        return false;
      }
      const root = APPARMOR_PROFILES_PATH + "/" + entry.name;
      const digestPath = root + "/raw_sha256";
      const digestStat = lstatSync(digestPath, { bigint: true });
      if (
        !digestStat.isSymbolicLink() ||
        digestStat.uid !== 0n ||
        (digestStat.mode & 0o7777n) !== 0o444n
      ) {
        return false;
      }
      const rawLink = readlinkSync(digestPath);
      const linkMatch = APPARMOR_RAW_LINK.exec(rawLink);
      if (linkMatch === null) {
        return false;
      }
      const rawTarget = APPARMOR_POLICY_PATH + "/raw_data/" + linkMatch[1] + "/sha256";
      metadata.push({
        entryName: entry.name,
        profileName: readBoundedVirtualText(root + "/name"),
        mode: readBoundedVirtualText(root + "/mode"),
        rawLink,
        rawDigest: readBoundedVirtualText(rawTarget),
      });
    }
    return validateFixtureProcessHostProfileMetadata(policy, metadata);
  } catch {
    return false;
  }
}

function authenticateLauncher(
  workspace: string,
  relativeLauncherPath: string,
  currentUid: bigint
): boolean {
  if (relativeLauncherPath !== EXPECTED_LAUNCHER_RELATIVE_PATH) {
    return false;
  }
  const launcherPath = resolve(workspace, relativeLauncherPath);
  if (launcherPath !== workspace + "/" + relativeLauncherPath) {
    return false;
  }

  const relativeSegments = relativeLauncherPath.split("/");
  let current = workspace;
  for (let i = 0; i < relativeSegments.length - 1; i++) {
    current = current + "/" + relativeSegments[i];
    if (!authenticateDirectory(current, [currentUid])) {
      return false;
    }
  }

  const stat = lstatSync(launcherPath, { bigint: true });
  if (stat.isSymbolicLink() || !stat.isFile()) {
    return false;
  }
  if (realpathSync(launcherPath) !== launcherPath) {
    return false;
  }
  if (stat.uid !== currentUid || stat.nlink !== 1n) {
    return false;
  }
  if ((stat.mode & UNSAFE_MODE_BITS) !== 0n) {
    return false;
  }

  const fd = openSync(
    launcherPath,
    constants.O_RDONLY | constants.O_NOFOLLOW | O_CLOEXEC_LINUX
  );
  try {
    const opened = fstatSync(fd, { bigint: true });
    if (!statsMatch(opened, stat)) {
      return false;
    }
    if (opened.size > MAX_AUTHENTICATED_BYTES) {
      return false;
    }
  } finally {
    closeSync(fd);
  }
  // Launcher bytes are bound by the authenticated candidate-view closure;
  // no separate digest exists at the host stage.
  return true;
}

const REQUIRED_SETENV_NAMES: ReadonlySet<string> = new Set([
  "HOME",
  "LANG",
  "LC_ALL",
  "NODE_PATH",
  "PATH",
  "TMPDIR",
  "USF_BWRAP_NETWORK",
  "USF_PROVIDER_HOME",
  "USF_REPOSITORY_ROOT",
]);
const REQUIRED_SETENV_COUNT = 9;
const SAFE_TOKEN = /^[A-Za-z0-9._-]+$/;
const UNSAFE_PATH_CHARS = /[\0,*?\[\]{}]/;
const ALLOW_FS_WRITE_PREFIX = "--allow-fs-write=";
const ALLOW_FS_READ_PREFIX = "--allow-fs-read=";
const TEST_NAME_PATTERN_PREFIX = "--test-name-pattern=";
const TEST_PATH_SUFFIX = ".test.ts";
const MAX_ORIGINAL_FS_READS = 8;
const MAX_FS_READS = 10;
const MAX_TEST_PATHS = 8;
const MAX_NODE_ARGUMENTS = 24;
const MAX_WIRE_BYTES = 32768;

function isLexicallyCanonicalAbsolute(path: string): boolean {
  if (typeof path !== "string" || path.length === 0 || !path.startsWith("/")) {
    return false;
  }
  if (UNSAFE_PATH_CHARS.test(path)) {
    return false;
  }
  if (path === "/") {
    return true;
  }
  for (const segment of path.split("/").slice(1)) {
    if (segment.length === 0 || segment === "." || segment === "..") {
      return false;
    }
  }
  return true;
}

function isLexicallyUnder(path: string, root: string): boolean {
  return isLexicallyCanonicalAbsolute(path) && path.startsWith(root + "/");
}

function isSafeRelativeTestPath(path: string): boolean {
  if (typeof path !== "string" || !path.endsWith(TEST_PATH_SUFFIX)) {
    return false;
  }
  if (path.startsWith("/") || path.startsWith("-")) {
    return false;
  }
  if (UNSAFE_PATH_CHARS.test(path)) {
    return false;
  }
  const segments = path.split("/");
  for (const segment of segments) {
    if (!SAFE_TOKEN.test(segment) || segment === "." || segment === "..") {
      return false;
    }
  }
  return segments[segments.length - 1].length > TEST_PATH_SUFFIX.length;
}

// Pure lexical builder: no filesystem, realpath, stat, open, or process IO.
// Sandbox-only destinations such as /fixture dependency aliases need not
// exist on the host for the launch wire to be produced.
export function fixtureProcessLaunchArguments(
  base: { executable: string; arguments: readonly string[] },
  policy: FixtureProcessPolicy,
  workspace: string
): Launch | null {
  try {
    if (base === null || typeof base !== "object") {
      return null;
    }
    if (base.executable !== "/usr/bin/bwrap") {
      return null;
    }
    if (!isLexicallyCanonicalAbsolute(workspace) || workspace === "/") {
      return null;
    }
    if (policy === null || typeof policy !== "object") {
      return null;
    }
    if (!policyShapeIsAuthentic(policy)) {
      return null;
    }
    if (
      !EXPECTED_MODE_IRIS.has(policy.modeIri) ||
      policy.confinementStrategy !== EXPECTED_CONFINEMENT_STRATEGY ||
      policy.fixtureProfileName !== EXPECTED_PROFILE_NAME ||
      policy.fixtureProfileAssetPath !== EXPECTED_PROFILE_ASSET_RELATIVE_PATH ||
      policy.fixtureInterpreterPath !== EXPECTED_INTERPRETER_PATH ||
      policy.fixtureLauncherPath !== EXPECTED_LAUNCHER_RELATIVE_PATH
    ) {
      return null;
    }
    if (
      !Array.isArray(policy.fixtureExecutables) ||
      policy.fixtureExecutables.length !== EXPECTED_FIXTURE_TOOLS.length
    ) {
      return null;
    }

    const executables: Array<{ path: string; digest: string }> = [];
    for (const expected of EXPECTED_FIXTURE_TOOLS) {
      const tool = policy.fixtureExecutables.find(
        (candidate) => candidate.iri === expected.iri
      );
      if (tool === undefined || tool.path !== expected.path) {
        return null;
      }
      if (!CANONICAL_SHA256.test(tool.rawDigest)) {
        return null;
      }
      executables.push({ path: tool.path, digest: tool.rawDigest });
    }

    const args = base.arguments;
    if (!Array.isArray(args) || args.length === 0) {
      return null;
    }
    for (const argument of args) {
      if (typeof argument !== "string" || argument.includes("\0")) {
        return null;
      }
    }
    if (args.filter((argument) => argument === "--").length !== 1) {
      return null;
    }

    let separatorIdx = -1;
    let unshareUser = 0;
    let unsharePid = 0;
    let unshareNet = 0;
    let dieWithParent = 0;
    let clearenv = 0;
    let tmpfsRoot = 0;
    let procMount = 0;
    let devMount = 0;
    let scratchBind = 0;
    let chdirCount = 0;
    let pathValueIdx = -1;
    let bindPath: string | null = null;
    let nodePathValue: string | null = null;
    let tmpdirValue: string | null = null;
    const roBinds: Array<readonly [string, string]> = [];
    const setenvNames = new Set<string>();

    let i = 0;
    while (i < args.length) {
      const token = args[i];
      if (token === "--") {
        separatorIdx = i;
        break;
      }
      if (token === "--unshare-user") {
        unshareUser += 1;
        i += 1;
        continue;
      }
      if (token === "--unshare-pid") {
        unsharePid += 1;
        i += 1;
        continue;
      }
      if (token === "--unshare-net") {
        unshareNet += 1;
        i += 1;
        continue;
      }
      if (token === "--die-with-parent") {
        dieWithParent += 1;
        i += 1;
        continue;
      }
      if (token === "--clearenv") {
        clearenv += 1;
        i += 1;
        continue;
      }
      if (token === "--tmpfs") {
        if (i + 1 >= args.length || args[i + 1] !== "/") {
          return null;
        }
        tmpfsRoot += 1;
        i += 2;
        continue;
      }
      if (token === "--proc") {
        if (i + 1 >= args.length || args[i + 1] !== "/proc") {
          return null;
        }
        procMount += 1;
        i += 2;
        continue;
      }
      if (token === "--dev") {
        if (i + 1 >= args.length || args[i + 1] !== "/dev") {
          return null;
        }
        devMount += 1;
        i += 2;
        continue;
      }
      if (token === "--ro-bind") {
        if (i + 2 >= args.length) {
          return null;
        }
        if (
          !isLexicallyCanonicalAbsolute(args[i + 1]) ||
          !isLexicallyCanonicalAbsolute(args[i + 2])
        ) {
          return null;
        }
        roBinds.push([args[i + 1], args[i + 2]]);
        i += 3;
        continue;
      }
      if (token === "--bind") {
        if (i + 2 >= args.length) {
          return null;
        }
        const source = args[i + 1];
        if (
          source !== args[i + 2] ||
          !isLexicallyUnder(source, workspace) ||
          source === workspace
        ) {
          return null;
        }
        scratchBind += 1;
        bindPath = source;
        i += 3;
        continue;
      }
      if (token === "--chdir") {
        if (i + 1 >= args.length || args[i + 1] !== workspace) {
          return null;
        }
        chdirCount += 1;
        i += 2;
        continue;
      }
      if (token === "--setenv") {
        if (i + 2 >= args.length) {
          return null;
        }
        const name = args[i + 1];
        if (!REQUIRED_SETENV_NAMES.has(name) || setenvNames.has(name)) {
          return null;
        }
        if (name === "PATH") {
          if (args[i + 2] !== "") {
            return null;
          }
          pathValueIdx = i + 2;
        }
        if (name === "NODE_PATH") {
          nodePathValue = args[i + 2];
        }
        if (name === "TMPDIR") {
          tmpdirValue = args[i + 2];
        }
        setenvNames.add(name);
        i += 3;
        continue;
      }
      return null;
    }

    if (separatorIdx < 0) {
      return null;
    }
    if (
      unshareUser !== 1 ||
      unsharePid !== 1 ||
      unshareNet !== 1 ||
      dieWithParent !== 1 ||
      clearenv !== 1
    ) {
      return null;
    }
    if (
      tmpfsRoot !== 1 ||
      procMount !== 1 ||
      devMount !== 1 ||
      scratchBind !== 1 ||
      chdirCount !== 1
    ) {
      return null;
    }
    if (setenvNames.size !== REQUIRED_SETENV_COUNT || pathValueIdx < 0) {
      return null;
    }

    const command = args.slice(separatorIdx + 1);
    if (command.length < 2 || command[0] !== "/usr/bin/node") {
      return null;
    }
    const nodeArgs = command.slice(1);
    if (nodeArgs[0] !== "--permission") {
      return null;
    }

    const fsFlags: string[] = [];
    let writeValue: string | null = null;
    const reads: string[] = [];
    let j = 1;
    while (j < nodeArgs.length && nodeArgs[j] !== "--test") {
      const flag = nodeArgs[j];
      if (flag.startsWith(ALLOW_FS_WRITE_PREFIX)) {
        if (writeValue !== null) {
          return null;
        }
        const value = flag.slice(ALLOW_FS_WRITE_PREFIX.length);
        if (!isLexicallyUnder(value, workspace)) {
          return null;
        }
        writeValue = value;
      } else if (flag.startsWith(ALLOW_FS_READ_PREFIX)) {
        // Reads follow one fixed positional grammar and precede the write.
        if (writeValue !== null) {
          return null;
        }
        const value = flag.slice(ALLOW_FS_READ_PREFIX.length);
        if (!isLexicallyCanonicalAbsolute(value) || value === "/") {
          return null;
        }
        if (reads.includes(value)) {
          return null;
        }
        reads.push(value);
        if (reads.length > MAX_ORIGINAL_FS_READS) {
          return null;
        }
      } else {
        return null;
      }
      fsFlags.push(flag);
      j += 1;
    }
    if (
      writeValue === null ||
      reads.length !== 5 ||
      reads[0] !== workspace ||
      reads[1] === workspace ||
      reads[2] === workspace ||
      reads[3] !== "/etc/passwd" ||
      reads[4] !== "/proc/net/route"
    ) {
      return null;
    }
    const root0 = reads[1];
    const root1 = reads[2];
    if (nodePathValue !== root0) {
      return null;
    }
    if (
      bindPath === null ||
      writeValue !== bindPath ||
      tmpdirValue !== bindPath
    ) {
      return null;
    }
    const requiredMounts = ["/usr", "/lib", "/lib64", workspace, root0, root1];
    const aliasNodeModules = workspace + "/node_modules";
    const aliasCache = workspace + "/.usf/cache";
    const boundDestinations = new Set<string>();
    let requiredMountCount = 0;
    for (const [source, destination] of roBinds) {
      if (boundDestinations.has(destination)) {
        return null;
      }
      boundDestinations.add(destination);
      if (source === destination) {
        if (!requiredMounts.includes(destination)) {
          return null;
        }
        requiredMountCount += 1;
        continue;
      }
      // Only the two dependency-root aliases may diverge from
      // source=destination, each onto exactly its own sandbox path.
      if (source === root0 && destination === aliasNodeModules) {
        continue;
      }
      if (source === root1 && destination === aliasCache) {
        continue;
      }
      return null;
    }
    if (requiredMountCount !== requiredMounts.length) {
      return null;
    }

    const testIdx = j;
    if (testIdx >= nodeArgs.length || nodeArgs[testIdx] !== "--test") {
      return null;
    }
    j += 1;
    if (j >= nodeArgs.length || nodeArgs[j] !== "--test-isolation=none") {
      return null;
    }
    j += 1;
    if (j < nodeArgs.length && nodeArgs[j].startsWith(TEST_NAME_PATTERN_PREFIX)) {
      const pattern = nodeArgs[j].slice(TEST_NAME_PATTERN_PREFIX.length);
      if (!SAFE_TOKEN.test(pattern)) {
        return null;
      }
      j += 1;
    }

    const testPaths = nodeArgs.slice(j);
    if (testPaths.length < 1 || testPaths.length > MAX_TEST_PATHS) {
      return null;
    }
    const seenTestPaths = new Set<string>();
    for (const testPath of testPaths) {
      if (!isSafeRelativeTestPath(testPath) || seenTestPaths.has(testPath)) {
        return null;
      }
      seenTestPaths.add(testPath);
    }

    const nodeArguments = [
      "--permission",
      "--allow-child-process",
      ...fsFlags,
      ALLOW_FS_READ_PREFIX + "/proc",
      ALLOW_FS_READ_PREFIX + "/usr/bin",
      ...nodeArgs.slice(testIdx),
    ];
    if (nodeArguments.length > MAX_NODE_ARGUMENTS) {
      return null;
    }
    if (reads.length + 2 > MAX_FS_READS) {
      return null;
    }

    const wire = policy.modeIri === PERMISSION_FIXTURE_PROCESS_MODE_IRI
      ? JSON.stringify({
          version: 2,
          apparmorProfile: policy.fixtureProfileName,
          executables,
          nodeArguments,
        })
      : JSON.stringify({
          version: 3,
          executionMode: NATIVE_FIXTURE_PROCESS_MODE_IRI,
          apparmorProfile: policy.fixtureProfileName,
          executables,
          filesystemReadPaths: [
            ...reads,
            "/proc",
            "/usr/bin",
          ],
          filesystemWritePath: writeValue,
          nodeArguments: [
            "--no-addons",
            ...nodeArgs.slice(testIdx),
          ],
        });
    if (Buffer.byteLength(wire, "utf8") > MAX_WIRE_BYTES) {
      return null;
    }

    const prefix = args.slice(0, separatorIdx);
    prefix[pathValueIdx] = "/usr/bin";

    return Object.freeze({
      executable: "/usr/bin/bwrap",
      arguments: Object.freeze([
        ...prefix,
        "--",
        EXPECTED_INTERPRETER_PATH,
        "-I",
        "-S",
        "-B",
        workspace + "/" + EXPECTED_LAUNCHER_RELATIVE_PATH,
        "--fixture-process-v2",
        wire,
      ]),
    });
  } catch {
    return null;
  }
}

export function confinedFixtureProcessLaunch(
  base: { executable: string; arguments: readonly string[] },
  policy: FixtureProcessPolicy,
  workspace: string
): Launch | null {
  if (!authenticateFixtureProcessPolicy(policy, workspace)) {
    return null;
  }
  return fixtureProcessLaunchArguments(base, policy, workspace);
}
