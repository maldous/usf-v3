import type { PathLike } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const [root, sourceRoot, entrypoint, rootIdentity, profile, manifestPath, boundary, sourcePath, ...bundlePaths] = process.argv.slice(2);
if (!root || !sourceRoot || !rootIdentity || !profile || !manifestPath || !sourcePath
  || !["canonical", "legacy"].includes(entrypoint ?? "")
  || (entrypoint === "legacy" && (bundlePaths.length < 1 || bundlePaths.length > 32))
  || (entrypoint === "canonical" && bundlePaths.length !== 0)
  || !["before-source", "source-before-receipt", "receipt-pending-before-link", "receipt-linked-before-cleanup", "receipt-before-ack"].includes(boundary ?? "") || !process.send) {
  throw new Error("Invalid completion-publication interruption fixture invocation");
}

const repositoryRoot = resolve(root);
const nativeRoot = resolve(sourceRoot);
const sourceAbsolute = resolve(repositoryRoot, sourcePath);
const receiptDirectory = resolve(repositoryRoot, "evidence", "work-completion");
if (!isAbsolute(sourceRoot) || relative(repositoryRoot, sourceAbsolute) === "" || relative(repositoryRoot, sourceAbsolute).startsWith(`..${sep}`)) {
  throw new Error("Invalid completion-publication fixture containment");
}

function stopAtBoundary(kind: string, state: Readonly<Record<string, string>> = {}): never {
  process.send!({ kind: "boundary", boundary: kind, ...state });
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  throw new Error("Completion-publication interruption barrier unexpectedly resumed");
}

const require = createRequire(import.meta.url);
const fs = require("node:fs") as {
  openSync: (path: PathLike, flags: number, mode?: number) => number;
  closeSync: (fd: number) => void;
  renameSync: (from: PathLike, to: PathLike) => void;
  linkSync: (existingPath: PathLike, newPath: PathLike) => void;
  unlinkSync: (path: PathLike) => void;
  fsyncSync: (fd: number) => void;
  fstatSync: (fd: number) => { readonly dev: number; readonly ino: number; isDirectory: () => boolean };
  statSync: (path: PathLike) => { readonly dev: number; readonly ino: number; isDirectory: () => boolean };
};
const openSync = fs.openSync;
const closeSync = fs.closeSync;
const renameSync = fs.renameSync;
const linkSync = fs.linkSync;
const unlinkSync = fs.unlinkSync;
const fsyncSync = fs.fsyncSync;
const fstatSync = fs.fstatSync;
const statSync = fs.statSync;
let receiptLinked = false;
let receiptTemporaryPath: string | null = null;
let receiptPath: string | null = null;
let receiptPendingDescriptor: number | null = null;
let receiptPendingPath: string | null = null;
let pendingParentPath: string | null = null;
let finalParentPath: string | null = null;
const pendingParentDescriptors = new Set<number>();
const finalParentDescriptors = new Set<number>();
let pendingReceiptDirectoryFsync = false;
let linkedReceiptDirectoryFsync = false;
let pendingCleanupDirectoryFsync = false;
let finalCleanupDirectoryFsync = false;

function observeReceiptParentDescriptor(descriptor: number, path: PathLike, parentPath: string | null, descriptors: Set<number>): void {
  if (parentPath === null || resolve(String(path)) !== parentPath) return;
  const directory = fstatSync(descriptor);
  const parent = statSync(parentPath);
  if (!directory.isDirectory() || !parent.isDirectory() || directory.dev !== parent.dev || directory.ino !== parent.ino) {
    throw new Error("Receipt parent descriptor identity mismatch");
  }
  descriptors.add(descriptor);
}

fs.openSync = ((path: PathLike, flags: number, mode?: number) => {
  const descriptor = openSync(path, flags, mode);
  if (String(path).endsWith(`${sep}receipt.pending`)) {
    receiptPendingDescriptor = descriptor;
    receiptPendingPath = resolve(String(path));
    pendingParentPath = dirname(receiptPendingPath);
  }
  observeReceiptParentDescriptor(descriptor, path, pendingParentPath, pendingParentDescriptors);
  observeReceiptParentDescriptor(descriptor, path, finalParentPath, finalParentDescriptors);
  return descriptor;
});
fs.closeSync = ((descriptor: number) => {
  closeSync(descriptor);
  pendingParentDescriptors.delete(descriptor);
  finalParentDescriptors.delete(descriptor);
  if (descriptor === receiptPendingDescriptor) {
    receiptPendingDescriptor = null;
    pendingReceiptDirectoryFsync = true;
  }
});
fs.renameSync = ((from: PathLike, to: PathLike) => {
  const destination = String(to);
  if (destination === sourceAbsolute && boundary === "before-source") stopAtBoundary(boundary);
  const result = renameSync(from, to);
  if (destination === sourceAbsolute && boundary === "source-before-receipt") stopAtBoundary(boundary);
  return result;
});
fs.linkSync = ((from: PathLike, to: PathLike) => {
  linkSync(from, to);
  const destination = resolve(String(to));
  if (destination.startsWith(receiptDirectory + sep) && destination.endsWith(".json")) {
    if (pendingParentPath === null) throw new Error("Receipt pending parent was not observed before link");
    receiptLinked = true;
    receiptTemporaryPath = resolve(String(from));
    receiptPath = destination;
    finalParentPath = dirname(destination);
    linkedReceiptDirectoryFsync = true;
  }
});
fs.unlinkSync = ((path: PathLike) => {
  unlinkSync(path);
  if (receiptLinked && resolve(String(path)) === receiptTemporaryPath) {
    pendingCleanupDirectoryFsync = true;
    finalCleanupDirectoryFsync = false;
  }
});
fs.fsyncSync = ((descriptor: number) => {
  fsyncSync(descriptor);
  const isPendingParent = pendingParentDescriptors.has(descriptor);
  const isFinalParent = finalParentDescriptors.has(descriptor);
  if (pendingReceiptDirectoryFsync && isPendingParent) {
    pendingReceiptDirectoryFsync = false;
    if (boundary === "receipt-pending-before-link") {
      if (receiptPendingPath === null) throw new Error("Receipt pending path was not observed");
      stopAtBoundary(boundary, { receiptPendingPath });
    }
  }
  if (linkedReceiptDirectoryFsync && isFinalParent) {
    linkedReceiptDirectoryFsync = false;
    if (boundary === "receipt-linked-before-cleanup") {
      if (receiptPendingPath === null || receiptPath === null) throw new Error("Linked receipt paths were not observed");
      stopAtBoundary(boundary, { receiptPendingPath, receiptPath });
    }
  }
  if (pendingCleanupDirectoryFsync && isPendingParent) {
    pendingCleanupDirectoryFsync = false;
    if (pendingParentPath === finalParentPath) {
      finalCleanupDirectoryFsync = false;
      if (boundary === "receipt-before-ack") stopAtBoundary(boundary);
    } else {
      finalCleanupDirectoryFsync = true;
    }
  }
  if (finalCleanupDirectoryFsync && isFinalParent) {
    finalCleanupDirectoryFsync = false;
    if (boundary === "receipt-before-ack") stopAtBoundary(boundary);
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
