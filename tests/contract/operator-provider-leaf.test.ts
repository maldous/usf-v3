import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

import {
  createProviderLeafCompletionAuthorizer,
  createProviderLeafDispatcher,
  invokeFreshLeafProtocolFixture,
  type FreshLeafChildEntryAuthority,
} from "../../src/commands/provider-leaf-dispatch.ts";
import { helpCommandResult } from "../../src/commands/help.ts";
import { sha256 } from "../../src/core/canonical.ts";

const profile = "urn:usf:profile:v3-self-host:3";
const manifest = "graph/manifests/self-host-provider-v3.json";
const digestA = `sha256:${"a".repeat(64)}`;
const digestB = `sha256:${"b".repeat(64)}`;

test("provider host help and static wiring remain operator-owned and profile scoped", () => {
  const host = (helpCommandResult(["providers", "host", "census", "--json"]).output as { command: { availability: string; externalContact: string; outputSchema: string; options: Array<{ syntax: string }> } }).command;
  assert.equal(host.availability, "registered");
  assert.equal(host.externalContact, "none");
  assert.equal(host.outputSchema, "urn:usf:provider-host-census-result:1");
  assert.ok(host.options.some((option) => option.syntax === "--provider-home ABSOLUTE_PATH"));
  const source = readFileSync(new URL("../../src/commands/providers.ts", import.meta.url), "utf8");
  assert.match(source, /createProviderLeafDispatcher\(\)/u);
  assert.match(source, /dispatchRegisteredProviderLeaf\(args, repositoryRoot\)/u);
  const launcher = readFileSync(new URL("../../bin/usf", import.meta.url), "utf8");
  assert.match(launcher, /call:parallel\|call:compare\|providers:host\|providers:receipt/u);
  assert.match(launcher, /\/usr\/bin\/flock --shared --nonblock/u);
  assert.match(launcher, /USF_DYNAMIC_LEAF_LOCK_FD=9/u);
  assert.match(launcher, /exec node -- .*src\/cli\.ts/u);
});

test("fresh init installs through the frozen closure and preserves the stable launcher lock", async (context) => {
  const permission = (process as typeof process & { permission?: { has(scope: string): boolean } }).permission;
  if (permission !== undefined && (!permission.has("child_process") || !permission.has("fs.write"))) {
    context.skip("confined bootstrap-child-unavailable");
    return;
  }
  const root = await mkdtemp(join(tmpdir(), "usf-fresh-init-"));
  context.after(async () => await rm(root, { recursive: true, force: true }));
  const fakeBin = join(root, "fake-bin");
  await mkdir(join(root, "bin"), { recursive: true });
  await mkdir(join(root, "scripts"), { recursive: true });
  await mkdir(fakeBin, { recursive: true });
  await writeFile(join(root, "bin/usf"), readFileSync(new URL("../../bin/usf", import.meta.url)));
  for (const name of ["bootstrap.sh", "env.sh", "verify-contained.sh"]) {
    await writeFile(join(root, "scripts", name), readFileSync(new URL("../../scripts/" + name, import.meta.url)));
    await chmod(join(root, "scripts", name), 0o755);
  }
  await chmod(join(root, "bin/usf"), 0o755);
  await writeFile(join(root, ".gitignore"), ".usf/\nnode_modules/\nbootstrap.log\nfake-bin/\n");
  await writeFile(join(root, "package.json"), '{"name":"usf-init-fixture","private":true}\n');
  await writeFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  await writeFile(join(root, "pnpm-workspace.yaml"), "packages: []\n");
  const log = join(root, "bootstrap.log");
  await writeFile(join(fakeBin, "corepack"), [
    "#!/bin/sh",
    "set -eu",
    "printf '%s\\n' \"$*\" >> \"$USF_BOOTSTRAP_TEST_LOG\"",
    "mkdir -p node_modules",
    ": > node_modules/.modules.yaml",
    "",
  ].join("\n"));
  await writeFile(join(fakeBin, "node"), [
    "#!/bin/sh",
    "set -eu",
    "if [ \"$1\" = \"--input-type=module\" ]; then",
    "  exec " + process.execPath + " \"$@\"",
    "fi",
    "printf '%s\\n' \"$*\" >> \"$USF_BOOTSTRAP_TEST_LOG\"",
    "case \"$*\" in",
    "  *\"models refresh\"*) mkdir -p .usf/catalog; : > .usf/catalog/models-dev.raw.json; : > .usf/catalog/models-dev.normalized.json ;;",
    "esac",
    "",
  ].join("\n"));
  await chmod(join(fakeBin, "corepack"), 0o755);
  await chmod(join(fakeBin, "node"), 0o755);
  const git = (args: readonly string[]): void => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  };
  git(["init", "-q"]);
  git(["add", "."]);
  const environment = { ...process.env, PATH: fakeBin + ":" + (process.env.PATH ?? ""), USF_BOOTSTRAP_TEST_LOG: log };
  const runInit = () => spawnSync(join(root, "bin/usf"), ["init"], { cwd: root, env: environment, encoding: "utf8" });
  const first = runInit();
  assert.equal(first.status, 0, first.stderr);
  assert.deepEqual(JSON.parse(first.stdout), { schema: "urn:usf:init:1", status: "ok", runtimeRoot: ".usf", providerContacted: false });
  const lockDirectory = await stat(join(root, ".usf/locks"));
  const firstLock = await stat(join(root, ".usf/locks/primary-mutation.lock"));
  assert.equal(lockDirectory.mode & 0o777, 0o700);
  assert.equal(firstLock.mode & 0o777, 0o600);
  assert.match(await readFile(log, "utf8"), /pnpm install --frozen-lockfile --prefer-offline/u);
  assert.match(await readFile(log, "utf8"), /models refresh --timeout-ms 30000 --max-bytes 33554432/u);
  assert.match(await readFile(log, "utf8"), /query --manifest graph\/manifests\/self-host-provider-v3\.json/u);
  const second = runInit();
  assert.equal(second.status, 0, second.stderr);
  const secondLock = await stat(join(root, ".usf/locks/primary-mutation.lock"));
  assert.deepEqual([secondLock.dev, secondLock.ino], [firstLock.dev, firstLock.ino], "repeat init preserves the coordination inode");
  const installCalls = (await readFile(log, "utf8")).split("\n").filter((line) => line.startsWith("pnpm install "));
  assert.deepEqual(installCalls, [
    "pnpm install --frozen-lockfile --prefer-offline",
    "pnpm install --frozen-lockfile --offline",
  ], "repeat init verifies the frozen closure without registry fallback");
  assert.match(await readFile(log, "utf8"), /models summary/u);
});

test("injected fresh-child admission repeats authority and releases both locks before the handler", async () => {
  const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
  const events: string[] = [];
  let complete = true;
  let movedInChild = false;
  let moveBeforeChildAdmission = false;
  let missingRuntimeClosure = false;
  let missingExactEntry = false;
  let childRuns = 0;
  let loads = 0;
  let launcherEntries = 0;
  let contactCount = 0;
  const forwarded: Array<{ readonly command: string; readonly args: readonly string[]; readonly repositoryRoot: string }> = [];
  const runtimePaths = ["src/commands/provider-hosts.ts", "src/core/canonical.ts"] as const;
  const authorize = createProviderLeafCompletionAuthorizer({
    validateProfile: (value) => {
      if (value !== profile) throw new Error("profile");
      return value;
    },
    validateManifest: (value) => {
      if (value !== manifest) throw new Error("manifest");
      return value;
    },
    deriveOwnerWork: ({ work }) => {
      const host = work === "urn:usf:work:provider-census";
      const modulePath = host ? "src/commands/provider-hosts.ts" : "src/commands/provider-receipts.ts";
      return ({
      status: "ok",
      items: [{
        id: work,
        contract: host ? "urn:usf:contract:provider-census:1" : "urn:usf:contract:provider-account-tier-receipt:1",
        scopedDependencyDigest: digestA,
        realisationBasis: { basisDigest: digestA },
        semanticDependencies: runtimePaths.map((path) => ({ key: path, digest: movedInChild && path === "src/core/canonical.ts" ? digestB : digestA, kind: "file" })),
        requirements: missingRuntimeClosure ? [] : [{
          id: "urn:fixture:closure",
          types: ["urn:usf:type:ProductionLeafRuntimeClosure"],
          fields: [
            { predicate: "urn:usf:predicate:ownerWork", value: work, valueKind: "iri" as const },
            { predicate: "urn:usf:predicate:entryModulePath", value: modulePath, valueKind: "literal" as const },
            { predicate: "urn:usf:predicate:closureMemberCount", value: String(runtimePaths.length), valueKind: "literal" as const },
            ...runtimePaths.map((path) => ({ predicate: "urn:usf:predicate:runtimePath", value: path, valueKind: "literal" as const })),
          ],
        }],
        realisationStage: {
          stage: complete ? "verified-complete" : "proofblocked",
          completion: { verified: complete, proofResult: complete ? "urn:fixture:proof" : null, reasonCodes: complete ? [] : ["FIXTURE_INCOMPLETE"] },
        },
      }],
    });
    },
  });
  const childEntry: FreshLeafChildEntryAuthority = Object.freeze({
    work: "urn:usf:work:operator-observability",
    contract: "urn:usf:contract:operator-observability:1",
    basisDigest: digestA,
    scopedDependencyDigest: digestA,
    path: "src/commands/provider-leaf-dispatch.ts",
    digest: digestA,
    dependency: Object.freeze({ path: "src/commands/provider-leaf-dispatch.ts", digest: digestA, roles: Object.freeze(["file"] as const) }),
  });
  const dispatch = createProviderLeafDispatcher({
    authorize,
    authenticate: async (_authorization, dependencies) => { events.push(`closure:${dependencies.map((item) => item.path).join(",")}`); },
    authorizeChildEntry: async () => { events.push("entry:authorize"); return childEntry; },
    authenticateChildEntry: async () => { events.push("entry:authenticate"); },
    launcherLock: async () => {
      launcherEntries += 1;
      return ({
      validate: async () => { events.push("parent-lock:validate"); },
      release: async () => { events.push("parent-lock:release"); },
      });
    },
    withImportLock: async (_root, action) => {
      events.push("child-lock:enter");
      try { return await action(); }
      finally { events.push("child-lock:release"); }
    },
    load: async (specifier) => {
      loads += 1;
      events.push(`load:${specifier.endsWith("/src/commands/provider-hosts.ts")}`);
      if (missingExactEntry) {
        assert.equal(specifier, pathToFileURL(resolve(repositoryRoot, "src/commands/provider-hosts.ts")).href);
        throw Object.assign(new Error("controlled exact missing entry"), { code: "ERR_MODULE_NOT_FOUND", url: specifier });
      }
      return {
        providerHostsCommandHandler: (request: { command: string; args: readonly string[]; repositoryRoot: string }) => {
          events.push("handler");
          forwarded.push(request);
          return { output: { status: "delegated" } };
        },
      };
    },
    runChild: async ({ request, prepareChild, validateParentLock, releaseParentLock }) => {
      childRuns += 1;
      if (moveBeforeChildAdmission) movedInChild = true;
      const handler = await prepareChild();
      events.push("prepared");
      await validateParentLock();
      await releaseParentLock();
      events.push("acknowledged");
      return handler({ command: "providers", args: request.args, repositoryRoot: request.repositoryRoot });
    },
  });
  const args = ["host", "census", "--profile", profile, "--manifest", manifest, "--max-items", "1"] as const;
  assert.deepEqual({ events, childRuns, loads, launcherEntries }, { events: [], childRuns: 0, loads: 0, launcherEntries: 0 }, "dispatcher construction is lazy");
  assert.equal(await dispatch(["census"], repositoryRoot), null);
  assert.deepEqual({ events, childRuns, loads, launcherEntries }, { events: [], childRuns: 0, loads: 0, launcherEntries: 0 }, "a nonleaf neither enters the launcher nor imports a feature");
  assert.deepEqual(await dispatch(args, repositoryRoot), { output: { status: "delegated" } });
  assert.equal(loads, 1);
  assert.deepEqual(forwarded, [{
    command: "providers",
    args: ["census", "--profile", profile, "--manifest", manifest, "--max-items", "1"],
    repositoryRoot,
  }], "the host leaf forwards the exact operation, scope and repository root");
  assert.ok(events.indexOf("child-lock:release") < events.indexOf("prepared"));
  assert.ok(events.indexOf("prepared") < events.indexOf("parent-lock:release"));
  assert.ok(events.indexOf("parent-lock:release") < events.indexOf("acknowledged"));
  assert.ok(events.indexOf("acknowledged") < events.indexOf("handler"));
  assert.ok(events.filter((event) => event === "entry:authorize").length >= 2, "parent and child both rederive current operator child-entry authority");
  assert.ok(events.filter((event) => event === "entry:authenticate").length >= 3, "parent and child authenticate and post-import reauthenticate child-entry bytes");

  events.length = 0;
  moveBeforeChildAdmission = true;
  await assert.rejects(dispatch(args, repositoryRoot), { code: "PROVIDERS_HOST_DEPENDENCY_REFUSED", exitCode: 4 });
  assert.equal(loads, 1, "shared/preloaded closure movement refuses before a second feature import");
  assert.ok(events.includes("parent-lock:release"), "movement refusal releases the launcher lock");

  moveBeforeChildAdmission = false;
  movedInChild = false;
  complete = false;
  const beforeBlockedRun = childRuns;
  await assert.rejects(dispatch(args, repositoryRoot), { code: "PROVIDERS_HOST_PROOFBLOCKED", exitCode: 1 });
  assert.equal(childRuns, beforeBlockedRun, "incomplete work refuses before child launch");

  const loadsBeforeReceipt = loads;
  await assert.rejects(
    dispatch(["receipt", "verify", "--profile", profile, "--manifest", manifest], repositoryRoot),
    { code: "PROVIDERS_RECEIPT_PROOFBLOCKED", exitCode: 1 },
  );
  assert.equal(childRuns, beforeBlockedRun);
  assert.equal(loads, loadsBeforeReceipt, "a present but unqualified receipt leaf refuses before child/import");

  complete = true;
  missingRuntimeClosure = true;
  const beforeMissingClosureChild = childRuns;
  await assert.rejects(dispatch(args, repositoryRoot), { code: "PROVIDERS_HOST_DEPENDENCY_REFUSED", exitCode: 4 });
  assert.equal(childRuns, beforeMissingClosureChild);
  assert.equal(loads, loadsBeforeReceipt, "a missing typed runtime closure refuses before child/import");
  missingRuntimeClosure = false;

  const beforeScopeChild = childRuns;
  await assert.rejects(
    dispatch(["host", "census", "--profile", profile, "--profile", profile, "--manifest", manifest], repositoryRoot),
    { code: "PROVIDERS_HOST_SCOPE_REQUIRED", exitCode: 2 },
  );
  await assert.rejects(
    dispatch(["host", "census", "--profile", profile], repositoryRoot),
    { code: "PROVIDERS_HOST_SCOPE_REQUIRED", exitCode: 2 },
  );
  assert.equal(childRuns, beforeScopeChild, "duplicate or missing semantic scope refuses before child/import");

  const launchersBeforeCrossRoot = launcherEntries;
  await assert.rejects(dispatch(args, "/definitely/not/the/implementation/root"), { code: "PROVIDERS_HOST_ROOT_REFUSED", exitCode: 5 });
  assert.equal(launcherEntries, launchersBeforeCrossRoot, "cross-root authority refuses before launcher/import");

  missingExactEntry = true;
  const beforeMissingEntryChild = childRuns;
  await assert.rejects(dispatch(args, repositoryRoot), { code: "PROVIDERS_HOST_PROOFBLOCKED", exitCode: 1 });
  assert.equal(childRuns, beforeMissingEntryChild + 1);
  assert.equal(loads, loadsBeforeReceipt + 1, "only an exact entry-module ERR_MODULE_NOT_FOUND maps to host proofblocked");
  assert.equal(contactCount, 0, "all injected boundaries remain no-contact and invoke no provider or network client");
});

test("ordinary carrier runs two real scrubbed children around one owner-private fixture movement", async (context) => {
  const permission = (process as typeof process & { permission?: { has(scope: string): boolean } }).permission;
  if (permission !== undefined && !permission.has("child_process")) {
    context.skip("confined child-process-unavailable");
    return;
  }
  const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
  const relativePath = `.usf/inputs/operator-fresh-child-${process.pid}.mjs`;
  const absolutePath = resolve(repositoryRoot, relativePath);
  await mkdir(resolve(repositoryRoot, ".usf/inputs"), { recursive: true, mode: 0o700 });
  const previousKey = process.env.OPENAI_API_KEY;
  const previousProxy = process.env.HTTPS_PROXY;
  const previousNodeOptions = process.env.NODE_OPTIONS;
  process.env.OPENAI_API_KEY = "fixture-must-not-cross-child-boundary";
  process.env.HTTPS_PROXY = "http://fixture.invalid";
  process.env.NODE_OPTIONS = "--no-warnings";
  try {
    const beforeBytes = Buffer.from('export const fixtureValue = "before";\n');
    await writeFile(absolutePath, beforeBytes, { mode: 0o600 });
    let first;
    try {
      first = await invokeFreshLeafProtocolFixture(repositoryRoot, relativePath, sha256(beforeBytes));
    } catch (error) {
      const code = error instanceof Error ? (error as Error & { code?: string }).code : undefined;
      if (code === "ERR_ACCESS_DENIED" || (error instanceof Error && /permission.*child|child.*permission/iu.test(error.message))) {
        context.skip("confined child-process-unavailable");
        return;
      }
      throw error;
    }
    const afterBytes = Buffer.from('export const fixtureValue = "after";\n');
    await writeFile(absolutePath, afterBytes, { mode: 0o600 });
    const second = await invokeFreshLeafProtocolFixture(repositoryRoot, relativePath, sha256(afterBytes));
    const firstOutput = first.output as { fixtureValue: string; credentialInherited: boolean; proxyInherited: boolean; nodeOptionsInherited: boolean };
    const secondOutput = second.output as typeof firstOutput;
    assert.equal(firstOutput.fixtureValue, "before");
    assert.equal(secondOutput.fixtureValue, "after", "a new process observes the sanctioned moved bytes instead of a stale ESM namespace");
    for (const output of [firstOutput, secondOutput]) {
      assert.equal(output.credentialInherited, false);
      assert.equal(output.proxyInherited, false);
      assert.equal(output.nodeOptionsInherited, false);
    }
  } finally {
    await unlink(absolutePath).catch(() => undefined);
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey;
    if (previousProxy === undefined) delete process.env.HTTPS_PROXY; else process.env.HTTPS_PROXY = previousProxy;
    if (previousNodeOptions === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = previousNodeOptions;
  }
});
