import type { PathLike } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const [root, sourceRoot, entrypoint, rootIdentity, profile, manifestPath, boundary, sourcePath, ...bundlePaths] = process.argv.slice(2);
if (!root || !sourceRoot || !rootIdentity || !profile || !manifestPath || !sourcePath
  || !["canonical", "legacy"].includes(entrypoint ?? "")
  || (entrypoint === "legacy" && (bundlePaths.length < 1 || bundlePaths.length > 32))
  || (entrypoint === "canonical" && bundlePaths.length !== 0)
  || !["before-source", "source-before-receipt", "receipt-before-ack"].includes(boundary ?? "") || !process.send) {
  throw new Error("Invalid completion-publication interruption fixture invocation");
}

const repositoryRoot = resolve(root);
const nativeRoot = resolve(sourceRoot);
const sourceAbsolute = resolve(repositoryRoot, sourcePath);
const receiptDirectory = resolve(repositoryRoot, "evidence", "work-completion");
if (!isAbsolute(sourceRoot) || relative(repositoryRoot, sourceAbsolute) === "" || relative(repositoryRoot, sourceAbsolute).startsWith(`..${sep}`)) {
  throw new Error("Invalid completion-publication fixture containment");
}

function stopAtBoundary(kind: string): never {
  process.send!({ kind: "boundary", boundary: kind });
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  throw new Error("Completion-publication interruption barrier unexpectedly resumed");
}

const require = createRequire(import.meta.url);
const fs = require("node:fs") as {
  renameSync: (from: PathLike, to: PathLike) => void;
  linkSync: (existingPath: PathLike, newPath: PathLike) => void;
  unlinkSync: (path: PathLike) => void;
  fsyncSync: (fd: number) => void;
};
const renameSync = fs.renameSync;
const linkSync = fs.linkSync;
const unlinkSync = fs.unlinkSync;
const fsyncSync = fs.fsyncSync;
let receiptLinked = false;
let receiptTemporaryPath: string | null = null;
let settledReceiptDurabilityFsyncs = 0;
fs.renameSync = ((from: PathLike, to: PathLike) => {
  const destination = String(to);
  if (destination === sourceAbsolute && boundary === "before-source") stopAtBoundary(boundary);
  const result = renameSync(from, to);
  if (destination === sourceAbsolute && boundary === "source-before-receipt") stopAtBoundary(boundary);
  return result;
});
fs.linkSync = ((from: PathLike, to: PathLike) => {
  linkSync(from, to);
  const destination = String(to);
  if (destination.startsWith(receiptDirectory + sep) && destination.endsWith(".json")) {
    receiptLinked = true;
    receiptTemporaryPath = String(from);
  }
});
fs.unlinkSync = ((path: PathLike) => {
  unlinkSync(path);
  if (receiptLinked && String(path) === receiptTemporaryPath) settledReceiptDurabilityFsyncs = 0;
});
fs.fsyncSync = ((descriptor: number) => {
  fsyncSync(descriptor);
  if (receiptLinked && receiptTemporaryPath !== null) {
    settledReceiptDurabilityFsyncs += 1;
    if (boundary === "receipt-before-ack" && settledReceiptDurabilityFsyncs === (entrypoint === "canonical" ? 2 : 1)) {
      stopAtBoundary(boundary);
    }
  }
});
syncBuiltinESMExports();

const native = await import(pathToFileURL(resolve(nativeRoot, "src/commands/work-completion.ts")).href);
const result = entrypoint === "canonical"
  ? await native.runCanonicalCompletionPublication(repositoryRoot, Object.freeze({ rootIdentity, manifestPath, mode: "apply" }))
  : await native.completionAwarePublishCommandHandler({
    command: "publish",
    repositoryRoot,
    args: ["work-completion", ...bundlePaths.flatMap((bundlePath) => ["--bundle", bundlePath]), "--profile", profile, "--manifest", manifestPath, "--apply"],
  });
process.send({ kind: "result", result }, undefined, undefined, () => process.disconnect());
