import assert from "node:assert/strict";
import { spawn, spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  appendFile,
  chmod,
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readlink,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer, type ListenOptions } from "node:net";
import { basename, dirname, join } from "node:path";
import test from "node:test";

const EXPECTED_ENVIRONMENT_KEYS = [
  "HOME",
  "LANG",
  "LC_ALL",
  "NODE_PATH",
  "NODE_TEST_WORKER_ID",
  "PATH",
  "TMPDIR",
  "USF_BWRAP_NETWORK",
  "USF_PROVIDER_HOME",
  "USF_REPOSITORY_ROOT",
] as const;

const NATIVE_DENIAL_CODES = new Set(["EACCES", "EPERM"]);
const SECRET_NAME = /(?:secret|token|password|passwd|credential|api[_-]?key|private[_-]?key)/i;

type FailureClass =
  | "ENVIRONMENT_MISMATCH"
  | "IDENTITY_MISMATCH"
  | "LOCK_SETUP_FAILED"
  | "LOCK_TIMEOUT"
  | "LOCK_EXCLUSIVITY_FAILED"
  | "NATIVE_EXECUTION_NOT_DENIED"
  | "SCRATCH_IO_FAILED"
  | "OUTSIDE_WRITE_NOT_DENIED"
  | "UNSUPPORTED_PLATFORM"
  | "ROUTE_TABLE_MISMATCH"
  | "SOCKET_PERMISSION_NOT_DENIED"
  | "TOOL_EXECUTION_FAILED";

class FixtureProcessConfinementFailure extends Error {
  readonly classification: FailureClass;
  readonly detail: Readonly<Record<string, unknown>>;

  constructor(
    classification: FailureClass,
    message: string,
    detail: Readonly<Record<string, unknown>> = {},
  ) {
    super(`${classification}: ${message}`);
    this.name = "FixtureProcessConfinementFailure";
    this.classification = classification;
    this.detail = detail;
  }
}

function classified(
  condition: unknown,
  classification: FailureClass,
  message: string,
  detail: Readonly<Record<string, unknown>> = {},
): asserts condition {
  if (!condition) {
    throw new FixtureProcessConfinementFailure(classification, message, detail);
  }
}

function resultSummary(result: SpawnSyncReturns<Buffer>): Readonly<Record<string, unknown>> {
  return {
    status: result.status,
    signal: result.signal,
    errorCode:
      result.error !== undefined && "code" in result.error
        ? String(result.error.code)
        : undefined,
    stderr: Buffer.isBuffer(result.stderr)
      ? result.stderr.toString("utf8").slice(0, 512)
      : null,
  };
}

function runApprovedTool(path: "/usr/bin/node" | "/usr/bin/git"): string {
  const result = spawnSync(path, ["--version"], {
    encoding: "buffer",
    timeout: 2_000,
    killSignal: "SIGKILL",
  });
  classified(
    result.error === undefined && result.status === 0 && result.signal === null,
    "TOOL_EXECUTION_FAILED",
    `approved tool did not complete successfully: ${path}`,
    resultSummary(result),
  );
  const version = result.stdout.toString("utf8").trim();
  classified(
    version.length > 0,
    "TOOL_EXECUTION_FAILED",
    `approved tool returned an empty version: ${path}`,
  );
  return version;
}

function assertNativeExecutionDenied(path: string, label: string): void {
  const result = spawnSync(path, [], {
    encoding: "buffer",
    timeout: 2_000,
    killSignal: "SIGKILL",
  });
  const code =
    result.error !== undefined && "code" in result.error
      ? String(result.error.code)
      : undefined;
  classified(
    result.status === null && result.signal === null && code !== undefined && NATIVE_DENIAL_CODES.has(code),
    "NATIVE_EXECUTION_NOT_DENIED",
    `${label} must be refused by the OS with EACCES or EPERM`,
    { path, ...resultSummary(result) },
  );
}

async function discoverDynamicLoader(): Promise<string> {
  const maps = await readFile("/proc/self/maps", "utf8");
  const candidates = new Set<string>();
  for (const line of maps.split("\n")) {
    const match = /^[0-9a-f]+-[0-9a-f]+\s+r-xp\s+[0-9a-f]+\s+\S+\s+\d+\s+(.+)$/.exec(line);
    if (match === null) continue;
    const path = match[1].trim().replace(/ \(deleted\)$/, "");
    if (
      path.startsWith("/") &&
      (/(?:^|\/)ld-linux[^/]*\.so(?:\.[0-9]+)*$/.test(path) ||
        /(?:^|\/)ld-musl-[^/]+\.so\.1$/.test(path))
    ) {
      candidates.add(path);
    }
  }
  classified(
    candidates.size === 1,
    "UNSUPPORTED_PLATFORM",
    "exactly one directly mapped dynamic loader must be derivable from /proc/self/maps",
    { candidates: [...candidates].sort() },
  );
  return [...candidates][0]!;
}

async function waitForFile(path: string, deadlineMs: number): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      await readFile(path);
      return;
    } catch (error: unknown) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new FixtureProcessConfinementFailure(
    "LOCK_TIMEOUT",
    "the flock holder did not confirm lock acquisition within two seconds",
    { path },
  );
}

async function proveExclusiveLocking(scratch: string): Promise<void> {
  const lockPath = join(scratch, "exclusive.lock");
  const readyPath = join(scratch, "holder.ready");
  const contenderPath = join(scratch, "contender.ran");
  const releasedPath = join(scratch, "released.ran");
  const holderScript =
    "const fs=require('node:fs');" +
    "fs.writeFileSync(process.argv[1],'ready');" +
    "setTimeout(()=>process.exit(0),1500);";
  const contenderScript = "require('node:fs').writeFileSync(process.argv[1],'ran')";
  const releasedScript = "require('node:fs').writeFileSync(process.argv[1],'released')";

  const holder = spawn(
    "/usr/bin/flock",
    ["--no-fork", "-x", lockPath, "/usr/bin/node", "-e", holderScript, readyPath],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let holderSettled = false;
  const holderCompletion = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve) => {
      holder.once("exit", (code, signal) => {
        holderSettled = true;
        resolve({ code, signal });
      });
      holder.once("error", () => {
        holderSettled = true;
        resolve({ code: null, signal: null });
      });
    },
  );
  let holderStderr = "";
  holder.stderr.setEncoding("utf8");
  holder.stderr.on("data", (chunk: string) => {
    holderStderr = (holderStderr + chunk).slice(-512);
  });

  try {
    await waitForFile(readyPath, 2_000);
    const contender = spawnSync(
      "/usr/bin/flock",
      ["-n", "-x", lockPath, "/usr/bin/node", "-e", contenderScript, contenderPath],
      { encoding: "buffer", timeout: 2_000, killSignal: "SIGKILL" },
    );
    classified(
      contender.error === undefined && contender.status === 1 && contender.signal === null,
      "LOCK_EXCLUSIVITY_FAILED",
      "a nonblocking contender must fail while the holder owns the lock",
      resultSummary(contender),
    );
    await assert.rejects(
      () => readFile(contenderPath),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT",
      "the refused contender must not execute Node",
    );
  } finally {
    if (!holderSettled) {
      holder.kill("SIGKILL");
    }
    let cleanupDeadline: NodeJS.Timeout | undefined;
    const exit = await Promise.race([
      holderCompletion,
      new Promise<never>((_resolve, reject) => {
        cleanupDeadline = setTimeout(() => {
          reject(
            new FixtureProcessConfinementFailure(
              "LOCK_SETUP_FAILED",
              "the lock holder did not complete cleanup within two seconds",
              { stderr: holderStderr },
            ),
          );
        }, 2_000);
      }),
    ]).finally(() => {
      if (cleanupDeadline !== undefined) {
        clearTimeout(cleanupDeadline);
      }
    });
    classified(
      exit.signal === "SIGKILL" || exit.code === 0,
      "LOCK_SETUP_FAILED",
      "the lock holder failed before controlled cleanup",
      { ...exit, stderr: holderStderr },
    );
  }

  const released = spawnSync(
    "/usr/bin/flock",
    ["-n", "-x", lockPath, "/usr/bin/node", "-e", releasedScript, releasedPath],
    { encoding: "buffer", timeout: 2_000, killSignal: "SIGKILL" },
  );
  classified(
    released.error === undefined && released.status === 0 && released.signal === null,
    "LOCK_EXCLUSIVITY_FAILED",
    "a fresh nonblocking contender must acquire the released lock",
    resultSummary(released),
  );
  const releasedMarker = await readFile(releasedPath, "utf8");
  classified(
    releasedMarker === "released",
    "LOCK_EXCLUSIVITY_FAILED",
    "the released-lock contender must execute Node and write the exact marker",
    { releasedMarker },
  );
}

async function assertListenPermissionDenied(
  options: ListenOptions,
  label: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = createServer();
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      server.close();
      reject(
        new FixtureProcessConfinementFailure(
          "SOCKET_PERMISSION_NOT_DENIED",
          `${label} did not produce a permission denial within two seconds`,
          { failure: "TIMEOUT" },
        ),
      );
    }, 2_000);

    const finish = (error: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const code = error instanceof Error && "code" in error ? String(error.code) : "";
      server.close();
      if (NATIVE_DENIAL_CODES.has(code)) {
        resolve();
        return;
      }
      reject(
        new FixtureProcessConfinementFailure(
          "SOCKET_PERMISSION_NOT_DENIED",
          `${label} must be refused by the OS with EACCES or EPERM`,
          { code, error: String(error) },
        ),
      );
    };

    server.once("error", finish);
    server.once("listening", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      server.close(() => {
        reject(
          new FixtureProcessConfinementFailure(
            "SOCKET_PERMISSION_NOT_DENIED",
            `${label} unexpectedly listened successfully`,
            { failure: "LISTEN_SUCCEEDED" },
          ),
        );
      });
    });

    try {
      server.listen(options);
    } catch (error: unknown) {
      finish(error);
    }
  });
}

test("fixture-process-confined", async () => {
  const environmentKeys = Object.keys(process.env).sort();
  assert.deepEqual(
    environmentKeys,
    [...EXPECTED_ENVIRONMENT_KEYS].sort(),
    new FixtureProcessConfinementFailure(
      "ENVIRONMENT_MISMATCH",
      "the process environment must contain exactly the nine supplied keys plus NODE_TEST_WORKER_ID",
      { actual: environmentKeys },
    ),
  );
  classified(
    process.env.NODE_TEST_WORKER_ID === "1",
    "ENVIRONMENT_MISMATCH",
    "NODE_TEST_WORKER_ID must be exactly 1",
    { actual: process.env.NODE_TEST_WORKER_ID },
  );
  classified(
    process.env.PATH === "/usr/bin",
    "ENVIRONMENT_MISMATCH",
    "PATH must be exactly /usr/bin",
    { actual: process.env.PATH },
  );
  classified(
    process.env.NODE_OPTIONS === undefined,
    "ENVIRONMENT_MISMATCH",
    "NODE_OPTIONS must not be present",
  );
  const ambientSecretKeys = environmentKeys.filter((key) => SECRET_NAME.test(key));
  classified(
    ambientSecretKeys.length === 0,
    "ENVIRONMENT_MISMATCH",
    "no ambient secret-looking environment keys may be present",
    { ambientSecretKeys },
  );

  const uidMapRows = (await readFile("/proc/self/uid_map", "utf8"))
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/).map(Number));
  assert.deepEqual(
    uidMapRows,
    [[1000, 0, 1]],
    new FixtureProcessConfinementFailure(
      "IDENTITY_MISMATCH",
      "/proc/self/uid_map must contain exactly the measured 1000 0 1 mapping",
      { uidMapRows },
    ),
  );
  classified(
    process.pid === 2 && process.ppid === 1,
    "IDENTITY_MISMATCH",
    "the current Node process must be PID 2 with PPID 1",
    { pid: process.pid, ppid: process.ppid },
  );

  const routeLines = (await readFile("/proc/net/route", "utf8")).trimEnd().split("\n");
  classified(
    routeLines.length >= 1 && routeLines[0]!.trim().startsWith("Iface\tDestination\tGateway"),
    "ROUTE_TABLE_MISMATCH",
    "the private network namespace must expose a parseable route table",
    { routeLines },
  );
  const usableRoutes = routeLines.slice(1).filter((line) => {
    if (line.trim() === "") return false;
    const fields = line.trim().split(/\s+/);
    const flags = Number.parseInt(fields[3] ?? "", 16);
    return Number.isFinite(flags) && (flags & 0x1) !== 0;
  });
  classified(
    usableRoutes.length === 0,
    "ROUTE_TABLE_MISMATCH",
    "the private route table must contain no usable route",
    { usableRoutes },
  );

  const scratch = process.env.TMPDIR;
  classified(
    typeof scratch === "string" && scratch.startsWith("/") && scratch !== "/",
    "SCRATCH_IO_FAILED",
    "TMPDIR must identify an absolute scoped scratch directory",
    { scratch },
  );
  await mkdir(scratch, { recursive: true, mode: 0o700 });

  const originalCwd = process.cwd();
  try {
    process.chdir(scratch);
    await assertListenPermissionDenied(
      { path: "named-stream.sock" },
      "named Unix stream socket binding under TMPDIR",
    );
  } finally {
    process.chdir(originalCwd);
  }
  await assertListenPermissionDenied(
    { path: "\0usf-fixture-process-stream" },
    "abstract Unix stream socket binding",
  );
  await assertListenPermissionDenied(
    { host: "127.0.0.1", port: 0 },
    "inet stream socket binding",
  );

  const scratchFile = join(scratch, "fixture-process-confinement.txt");
  await writeFile(scratchFile, "scratch-local\n", "utf8");
  classified(
    (await readFile(scratchFile, "utf8")) === "scratch-local\n",
    "SCRATCH_IO_FAILED",
    "scratch-local write and read must round-trip",
  );

  await assert.rejects(
    () => writeFile("/usr/bin/usf-fixture-process-write-probe", "refused\n", "utf8"),
    (error: unknown) => {
      const code = error instanceof Error && "code" in error ? String(error.code) : "";
      if (["ERR_ACCESS_DENIED", "EACCES", "EPERM", "EROFS"].includes(code)) return true;
      throw new FixtureProcessConfinementFailure(
        "OUTSIDE_WRITE_NOT_DENIED",
        "the outside-scratch write failed for an unexpected reason",
        { code, error: String(error) },
      );
    },
    "a write outside scratch must fail",
  );

  assert.match(runApprovedTool("/usr/bin/node"), /^v\d+\./);
  assert.match(runApprovedTool("/usr/bin/git"), /^git version \d+\./);
  await proveExclusiveLocking(scratch);

  assertNativeExecutionDenied("/usr/bin/sh", "shell");
  assertNativeExecutionDenied("/usr/bin/python3.12", "Python interpreter");
  assertNativeExecutionDenied(await discoverDynamicLoader(), "directly mapped dynamic loader");

  const copiedNode = join(scratch, "copied-node");
  await copyFile("/usr/bin/node", copiedNode);
  await chmod(copiedNode, 0o755);
  assertNativeExecutionDenied(copiedNode, "scratch-copied Node inode");

  await rm(scratchFile, { force: true });
  await rm(copiedNode, { force: true });
});

test("fixture-process-native-metadata", async () => {
  assert.equal("permission" in process, false, "native Node must not expose process.permission");

  const getuid = process.getuid;
  if (typeof getuid !== "function") {
    assert.fail("native Node must expose process.getuid");
  }
  const observedUid = getuid();

  const scratch = process.env.TMPDIR;
  assert.ok(
    typeof scratch === "string" && scratch.startsWith("/") && scratch !== "/",
    "TMPDIR must identify an absolute scoped scratch directory",
  );
  await mkdir(scratch, { recursive: true, mode: 0o700 });

  const payload = "native-metadata-payload\n";
  const originalPath = join(scratch, "native-metadata-original.txt");
  const renamedPath = join(scratch, "native-metadata-renamed.txt");
  const relativeLinkPath = join(scratch, "native-metadata-relative-link");
  await writeFile(originalPath, payload, { encoding: "utf8", mode: 0o640 });

  const handle = await open(originalPath, "r+");
  await handle.chmod(0o600);
  await handle.close();

  const originalMetadata = await stat(originalPath);
  assert.equal(originalMetadata.uid, observedUid);
  assert.equal(originalMetadata.mode & 0o777, 0o600);
  assert.equal(originalMetadata.nlink, 1);
  assert.equal(originalMetadata.isFile(), true);
  assert.equal(await readFile(originalPath, "utf8"), payload);

  await rename(originalPath, renamedPath);
  await assert.rejects(
    () => stat(originalPath),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT",
    "the exact old scratch path must be absent after rename",
  );
  const renamedMetadata = await stat(renamedPath);
  assert.equal(renamedMetadata.uid, observedUid);
  assert.equal(renamedMetadata.mode & 0o777, 0o600);
  assert.equal(renamedMetadata.nlink, 1);
  assert.equal(renamedMetadata.isFile(), true);
  assert.equal(await readFile(renamedPath, "utf8"), payload);

  const relativeTarget = basename(renamedPath);
  await symlink(relativeTarget, relativeLinkPath);
  const relativeLinkMetadata = await lstat(relativeLinkPath);
  assert.equal(relativeLinkMetadata.uid, observedUid);
  assert.equal(relativeLinkMetadata.nlink, 1);
  assert.equal(relativeLinkMetadata.isSymbolicLink(), true);
  assert.equal(await readlink(relativeLinkPath), relativeTarget);
  assert.equal(await readFile(relativeLinkPath, "utf8"), payload);

  const sourcePath = join(process.cwd(), "src/realisation/fixture-process-launcher.py");
  const readonlyTargets = [
    {
      label: "execution-view source",
      path: sourcePath,
      newLinkPath: join(dirname(sourcePath), "fixture-process-native-metadata-link"),
    },
    {
      label: "approved Node tool",
      path: "/usr/bin/node",
      newLinkPath: "/usr/bin/usf-fixture-process-native-metadata-link",
    },
  ] as const;
  const metadataDenialCodes = new Set(["EACCES", "EPERM", "EROFS"]);
  const isMetadataDenial = (error: unknown): boolean => {
    const code = error instanceof Error && "code" in error ? String(error.code) : "";
    return metadataDenialCodes.has(code);
  };

  for (const target of readonlyTargets) {
    const beforeBytes = await readFile(target.path);
    const beforeMetadata = await stat(target.path);
    await assert.rejects(
      () => lstat(target.newLinkPath),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT",
      `${target.label} new-link path must initially be absent`,
    );

    const readonlyHandle = await open(target.path, "r");
    try {
      await assert.rejects(
        () => readonlyHandle.chmod(0o600),
        isMetadataDenial,
        `${target.label} descriptor chmod must be denied by the OS`,
      );
    } finally {
      await readonlyHandle.close();
    }
    await assert.rejects(
      () => chmod(target.path, 0o600),
      isMetadataDenial,
      `${target.label} path chmod must be denied by the OS`,
    );
    await assert.rejects(
      () => appendFile(target.path, "native-metadata-mutation\n"),
      isMetadataDenial,
      `${target.label} write must be denied by the OS`,
    );
    await assert.rejects(
      () => symlink(basename(target.path), target.newLinkPath),
      isMetadataDenial,
      `${target.label} adjacent symlink creation must be denied by the OS`,
    );

    const afterMetadata = await stat(target.path);
    assert.deepEqual(await readFile(target.path), beforeBytes, `${target.label} bytes must remain exact`);
    assert.equal(afterMetadata.mode, beforeMetadata.mode, `${target.label} mode must remain exact`);
    await assert.rejects(
      () => lstat(target.newLinkPath),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT",
      `${target.label} refused new-link path must remain absent`,
    );
  }

  const readonlySourceBefore = await readFile(sourcePath);
  const readonlySourceModeBefore = (await stat(sourcePath)).mode;
  const scratchReadonlyLink = join(scratch, "native-metadata-readonly-source-link");
  await symlink(sourcePath, scratchReadonlyLink);
  assert.equal((await lstat(scratchReadonlyLink)).isSymbolicLink(), true);
  assert.equal(await readlink(scratchReadonlyLink), sourcePath);
  await assert.rejects(
    () => appendFile(scratchReadonlyLink, "native-metadata-symlink-mutation\n"),
    isMetadataDenial,
    "a scratch symlink must not permit mutation of the read-only execution-view source",
  );
  assert.deepEqual(await readFile(sourcePath), readonlySourceBefore);
  assert.equal((await stat(sourcePath)).mode, readonlySourceModeBefore);

  await rm(relativeLinkPath);
  await rm(scratchReadonlyLink);
  await rm(renamedPath);
});

test("fixture-process-default-denial", () => {
  assert.equal(process.permission.has("child_process"), false);
  assert.throws(
    () => spawnSync("/usr/bin/git", ["--version"]),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "ERR_ACCESS_DENIED",
    "child process execution must fail with ERR_ACCESS_DENIED",
  );
});
