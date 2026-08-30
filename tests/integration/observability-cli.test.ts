import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const usf = resolve(repositoryRoot, "bin/usf");
const digest = `sha256:${"a".repeat(64)}`;

type Json = Record<string, unknown>;

async function optionalText(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

function invoke(
  args: readonly string[],
  cwd: string,
  shimDirectory: string,
  log: string,
  mode: "deny" | "delegate",
  input?: string,
): ReturnType<typeof spawnSync> {
  return spawnSync(usf, args, {
    cwd,
    encoding: "utf8",
    input,
    timeout: 5_000,
    env: {
      ...process.env,
      PATH: `${shimDirectory}:${process.env.PATH ?? ""}`,
      GIT_SHIM_LOG: log,
      GIT_SHIM_MODE: mode,
      GIT_TERMINAL_PROMPT: "0",
    },
  });
}

function parseOutput(result: ReturnType<typeof spawnSync>, label: string): Json {
  assert.equal(result.error, undefined, `${label} must not time out`);
  assert.equal(result.status, 0, `${label} failed: ${result.stderr}`);
  assert.equal(result.stderr, "", `${label} wrote stderr`);
  return JSON.parse(String(result.stdout).trim()) as Json;
}

function assertNoAbsolutePathsOrSecrets(value: unknown): void {
  if (typeof value === "string") {
    assert.equal(value.includes(repositoryRoot), false, "output must not disclose the repository path");
    assert.equal(/(?:token|secret|password|authorization)/i.test(value), false, "output must not disclose secrets");
  } else if (Array.isArray(value)) {
    for (const item of value) assertNoAbsolutePathsOrSecrets(item);
  } else if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      assert.equal(/(?:token|secret|password|authorization)/i.test(key), false, "output must not carry secret-shaped keys");
      assertNoAbsolutePathsOrSecrets(item);
    }
  }
}

test("help is repository-free; status stays local; and metrics preserve unknown coverage", async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), "usf-observability-cli-"));
  const nonRepository = join(temporary, "not-a-repository");
  const shimDirectory = join(temporary, "bin");
  const log = join(temporary, "git.log");
  await Promise.all([
    mkdir(nonRepository),
    mkdir(shimDirectory),
    writeFile(log, ""),
  ]);
  const shim = join(shimDirectory, "git");
  await writeFile(
    shim,
    "#!/bin/sh\nprintf '%s\\n' \"$1\" >> \"$GIT_SHIM_LOG\"\nif [ \"$GIT_SHIM_MODE\" = deny ]; then exit 91; fi\nexec /usr/bin/git \"$@\"\n",
  );
  await chmod(shim, 0o755);
  t.after(async () => { await rm(temporary, { recursive: true, force: true }); });

  const humanHelp = invoke(["--help"], nonRepository, shimDirectory, log, "deny");
  assert.equal(humanHelp.status, 0, `human help failed: ${humanHelp.stderr}`);
  assert.match(String(humanHelp.stdout), /USF command interface/);
  const machineHelp = parseOutput(invoke(["help", "--json"], nonRepository, shimDirectory, log, "deny"), "machine help");
  assert.equal(machineHelp.schema, "urn:usf:cli-help:1");
  assert.equal(machineHelp.status, "ok");
  assert.equal(await optionalText(log), "", "help must not inspect Git or a repository");

  const status = parseOutput(invoke(["status"], repositoryRoot, shimDirectory, log, "delegate"), "broad status");
  assert.equal(status.schema, "urn:usf:status-result:1");
  assert.equal(status.externalContact, false);
  assert.equal((status.repository as Json).remoteContact, false);
  assert.equal((status.semantic as Json).status, "not-selected");
  assert.equal((status.terminalProof as Json).status, "not-evaluated");
  assert.ok((status.nonclaims as unknown[]).includes("no-full-anqr-staging-production-or-terminal-proof-claim"));
  assertNoAbsolutePathsOrSecrets(status);
  const gitOperations = (await optionalText(log)).trim().split("\n").filter(Boolean);
  assert.ok(gitOperations.length > 0, "broad status must record its local carrier reads through the shim");
  assert.ok(gitOperations.every((operation) => operation === "rev-parse" || operation === "diff-index"), `unexpected Git operation: ${gitOperations.join(", ")}`);

  const implicitOverlay = invoke(["start", "--profile", "urn:usf:profile:v3-self-host:1"], repositoryRoot, shimDirectory, log, "delegate");
  assert.equal(implicitOverlay.status, 2);
  assert.equal(JSON.parse(String(implicitOverlay.stdout).trim()).reasonCode, "LIFECYCLE_MANIFEST_REQUIRED", "start must never select a product manifest implicitly");

  const events = [
    {
      schema: "urn:usf:metric-event:1",
      at: "2026-08-30T00:00:00.000Z",
      kind: "completion",
      run: "run-1",
      requestedRoute: "route-requested",
      actualProvider: "provider-actual",
      actualModel: "model-actual",
      usage: { inputTokens: 4, outputTokens: 5 },
      outcome: "accepted",
      lineage: "accepted-candidate",
      contributionDigest: digest,
    },
    {
      schema: "urn:usf:metric-event:1",
      at: "2026-08-30T00:01:00.000Z",
      kind: "completion",
      run: "run-1",
      requestedRoute: "route-requested",
      actualProvider: "provider-actual",
      actualModel: "model-actual",
    },
  ].map((event) => JSON.stringify(event)).join("\n");
  const metrics = parseOutput(invoke(["metrics", "tokens", "--input", "-"], repositoryRoot, shimDirectory, log, "delegate", `${events}\n`), "metrics stdin");
  assert.equal(metrics.schema, "urn:usf:metrics-report:1");
  assert.equal(metrics.view, "tokens");
  assert.equal((metrics.denominators as Json).requestedRoutes, 1);
  assert.equal((metrics.denominators as Json).actualProviders, 1);
  assert.equal((metrics.totals as Json).totalTokens, null, "missing applicable usage must remain unknown, not zero");
  assert.equal((metrics.coverage as Json).usageUnknownEvents, 1);
  assert.equal(metrics.status, "incomplete");
});
