import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [root, sourceRoot, candidatePath, boundary] = process.argv.slice(2);
const boundaries = new Set(["beforemanifest", "aftermanifest", "betweeneffects", "afterfinal", "deltareadback"]);
if (!root || !sourceRoot || !candidatePath || !boundaries.has(boundary ?? "") || !process.send) {
  throw new Error("Invalid workspace interruption fixture invocation");
}

const candidate = JSON.parse(await fs.readFile(candidatePath, "utf8")) as {
  readonly digest: string;
  readonly operations: readonly { readonly path: string }[];
};
if (!/^sha256:[a-f0-9]{64}$/u.test(candidate.digest) || candidate.operations.length < 2
  || candidate.operations.some(operation => typeof operation.path !== "string" || operation.path === "")) {
  throw new Error("Workspace interruption fixture requires a bounded two-operation candidate.");
}

const workspace = resolve(root, ".usf", "workspaces", candidate.digest.slice("sha256:".length));
const manifest = resolve(workspace, ".usf-workspace.json");
const operationTargets = new Set(candidate.operations.map(operation => resolve(workspace, operation.path)));
const primaryOperationTargets = new Set(candidate.operations.map(operation => resolve(root, operation.path)));
let completedOperations = 0;
let manifestPublished = false;
let finalEffectsApplied = false;
let primaryReadsAfterFinal = 0;

function stopAtBoundary(): never {
  process.send!({ kind: "boundary", boundary, workspace, manifest, completedOperations });
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  throw new Error("Workspace interruption barrier unexpectedly resumed");
}

async function pauseForReadbackMutation(): Promise<void> {
  process.send!({ kind: "boundary", boundary, workspace, manifest, completedOperations });
  await new Promise<void>((accept, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out awaiting primary-drift mutation")), 120_000);
    process.once("message", message => {
      clearTimeout(timeout);
      if (message !== null && typeof message === "object" && (message as { kind?: unknown }).kind === "continue") accept();
      else reject(new Error("Workspace interruption fixture received an invalid resume message"));
    });
  });
}

const rename = fs.rename;
fs.rename = (async (...args: Parameters<typeof rename>) => {
  const destination = resolve(String(args[1]));
  if (destination === manifest && boundary === "beforemanifest") stopAtBoundary();
  await rename(...args);
  if (destination === manifest) {
    manifestPublished = true;
    if (boundary === "aftermanifest") stopAtBoundary();
  }
  if (manifestPublished && operationTargets.has(destination)) {
    completedOperations += 1;
    if (boundary === "betweeneffects" && completedOperations === 1) stopAtBoundary();
    if (completedOperations === candidate.operations.length) {
      finalEffectsApplied = true;
      if (boundary === "afterfinal") stopAtBoundary();
    }
  }
}) as typeof rename;

const readFile = fs.readFile;
fs.readFile = (async (...args: Parameters<typeof readFile>) => {
  const bytes = await readFile(...args);
  const path = resolve(String(args[0]));
  if (boundary === "deltareadback" && finalEffectsApplied && primaryOperationTargets.has(path)) {
    primaryReadsAfterFinal += 1;
    // The first read is the pre-delta reauthentication; block after the delta captured its before-image.
    if (primaryReadsAfterFinal === 2) await pauseForReadbackMutation();
  }
  return bytes;
}) as typeof readFile;
syncBuiltinESMExports();

const native = await import(pathToFileURL(resolve(sourceRoot, "src/realisation/index.ts")).href);
try {
  const result = await native.applyResolvedCandidate(root, candidate);
  process.send({ kind: "result", result }, undefined, undefined, () => process.disconnect());
} catch (error: unknown) {
  const failure = error as { readonly name?: unknown; readonly reasonCode?: unknown; readonly message?: unknown };
  process.send({ kind: "error", name: failure.name, reasonCode: failure.reasonCode, message: failure.message }, undefined, undefined, () => process.disconnect());
}
