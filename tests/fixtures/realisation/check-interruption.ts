import childProcess from "node:child_process";
import fs from "node:fs/promises";
import { constants } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [root, candidateDigest, validationId, boundary, pendingPath] = process.argv.slice(2);
if (!root || !candidateDigest || !validationId || !pendingPath
  || !["before-effect", "before-persist", "pending-synced", "receipt-published", "before-ack", "pre-spawn-manifest-drift", "legacy", "ensure", "preflight"].includes(boundary ?? "")
  || !process.send) throw new Error("Invalid interruption fixture invocation");

// Only this tracked test process installs interception. Native calls still run.
function stopAtBoundary(): never {
  process.send!({ kind: "boundary", boundary });
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  throw new Error("Interruption barrier unexpectedly resumed");
}
const spawn = childProcess.spawn;
childProcess.spawn = ((...args: Parameters<typeof spawn>) => {
  if (args[0] === "/usr/bin/bwrap") {
    if (boundary === "before-effect") stopAtBoundary();
    const child = spawn(...args);
    child.once("spawn", () => process.send!({ kind: "validation-spawn", pid: child.pid }));
    child.once("exit", (code, signal) => process.send!({ kind: "validation-exit", code, signal }));
    return child;
  }
  return spawn(...args);
}) as typeof spawn;
const mkdir = fs.mkdir;
let preSpawnManifestDrifted = false;
fs.mkdir = (async (...args: Parameters<typeof mkdir>) => {
  const result = await mkdir(...args);
  if (!preSpawnManifestDrifted && boundary === "pre-spawn-manifest-drift"
    && String(args[0]).endsWith(".usf-check-tmp/execution-view/.usf-check-runtime")) {
    const workspace = resolve(root!, ".usf", "workspaces", candidateDigest!.slice("sha256:".length));
    const manifest = resolve(workspace, ".usf-workspace.json");
    await fs.writeFile(manifest, Buffer.concat([await fs.readFile(manifest), Buffer.from("\n")]));
    preSpawnManifestDrifted = true;
    process.send!({ kind: "pre-spawn-manifest-drift" });
  }
  return result;
}) as typeof mkdir;
const open = fs.open;
fs.open = (async (...args: Parameters<typeof open>) => {
  const creating = typeof args[1] === "number" && (args[1] & constants.O_CREAT) !== 0;
  const receiptPath = pendingPath!.slice(0, -".pending".length);
  const intentPath = receiptPath.replace(/\.json$/u, ".intent.json");
  if (boundary === "receipt-published" && creating && String(args[0]) === `${intentPath}.pending`) {
    const retained = await fs.readFile(intentPath, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (retained !== null && JSON.parse(retained).state === "STARTED") {
      await fs.readFile(receiptPath);
      stopAtBoundary();
    }
  }
  const selected = String(args[0]) === pendingPath && typeof args[1] === "number"
    && (args[1] & constants.O_CREAT) !== 0;
  if (selected && boundary === "before-persist") stopAtBoundary();
  const handle = await open(...args);
  if (selected && boundary === "pending-synced") {
    const sync = handle.sync.bind(handle);
    handle.sync = async () => { await sync(); stopAtBoundary(); };
  }
  return handle;
}) as typeof open;
syncBuiltinESMExports();
const sourceRoot = resolve(import.meta.dirname, "../../..");
const native = await import(pathToFileURL(resolve(sourceRoot, "src/commands/check.ts")).href);
let result;
try {
  if (boundary === "preflight") {
    const { withCandidateLock } = await import(pathToFileURL(resolve(sourceRoot, "src/realisation/index.ts")).href);
    const disposition = await withCandidateLock(root, candidateDigest, () => native.authenticateGraphDerivedCheckIntent(root, candidateDigest, validationId));
    result = { status: "authenticated", disposition };
  } else {
    result = await (boundary === "legacy" ? native.runGraphDerivedCheck : native.ensureGraphDerivedCheck)(root, candidateDigest, validationId);
  }
} catch (error) {
  result = { status: "refused", reasonCode: (error as { reasonCode?: string }).reasonCode, message: error instanceof Error ? error.message : String(error), details: (error as { details?: unknown }).details };
}
if (boundary === "before-ack" && result.status === "pass") stopAtBoundary();
const expectedReturn = ["pre-spawn-manifest-drift", "legacy", "ensure", "preflight"].includes(boundary!);
process.send({ kind: expectedReturn ? "result" : "unexpected-result", result }, undefined, undefined, () => process.disconnect());
process.exitCode = expectedReturn ? 0 : 1;
