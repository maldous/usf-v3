import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { doctorCommandHandler } from "../../src/commands/doctor.ts";
import { modelsCommandHandler } from "../../src/commands/models.ts";
import { routeCommandHandler } from "../../src/commands/route.ts";
import { canonicalJson, sha256 } from "../../src/core/canonical.ts";
import { UsfError } from "../../src/core/errors.ts";
import { normalizeModelsDevCatalogue } from "../../src/providers/catalogue.ts";

const rawFixture = await readFile(fileURLToPath(new URL("../fixtures/providers/models-dev.json", import.meta.url)));
const workspaceTemporaryRoot = fileURLToPath(new URL("../../.usf/tmp/", import.meta.url));

async function privateTemporaryDirectory(prefix: string): Promise<string> {
  await mkdir(workspaceTemporaryRoot, { recursive: true, mode: 0o700 });
  await chmod(workspaceTemporaryRoot, 0o700);
  return mkdtemp(join(workspaceTemporaryRoot, prefix));
}

async function fixtureRepository(run: (repositoryRoot: string) => Promise<void>): Promise<void> {
  const repositoryRoot = await privateTemporaryDirectory("usf-models-command-");
  try {
    await mkdir(join(repositoryRoot, ".usf/catalog"), { recursive: true, mode: 0o700 });
    await chmod(join(repositoryRoot, ".usf"), 0o700);
    await chmod(join(repositoryRoot, ".usf/catalog"), 0o700);
    await writeFile(join(repositoryRoot, "package.json"), JSON.stringify({
      name: "models-command-fixture",
      private: true,
      dependencies: { "@ai-sdk/alpha": "1.2.3" },
    }));
    await mkdir(join(repositoryRoot, "node_modules/@ai-sdk/alpha"), { recursive: true });
    await writeFile(join(repositoryRoot, "node_modules/@ai-sdk/alpha/package.json"), JSON.stringify({
      name: "@ai-sdk/alpha",
      version: "1.2.3",
    }));
    const frozen = normalizeModelsDevCatalogue(rawFixture, { installedAdapters: { "@ai-sdk/alpha": "1.2.3" } });
    await writeFile(join(repositoryRoot, ".usf/catalog/models-dev.raw.json"), rawFixture, { mode: 0o600 });
    await writeFile(join(repositoryRoot, ".usf/catalog/models-dev.normalized.json"), canonicalJson(frozen), { mode: 0o600 });
    await chmod(join(repositoryRoot, ".usf/catalog/models-dev.raw.json"), 0o600);
    await chmod(join(repositoryRoot, ".usf/catalog/models-dev.normalized.json"), 0o600);
    await run(repositoryRoot);
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
}

test("models summary and list are bounded local views with explicit denominators", async () => {
  await fixtureRepository(async (repositoryRoot) => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error("local models commands must not contact a provider or catalogue"); };
    try {
      const summaryResult = await modelsCommandHandler({ command: "models", args: ["summary"], repositoryRoot });
      const summary = summaryResult.output as Record<string, any>;
      assert.equal(summary.operation, "summary");
      assert.equal(summary.externalContact, false);
      assert.equal(summary.source.externalContact, false);
      assert.match(summary.source.rawDigest, /^sha256:[a-f0-9]{64}$/u);
      assert.match(summary.source.normalizedDigest, /^sha256:[a-f0-9]{64}$/u);
      assert.equal(summary.denominators.catalogue.providerRoutes, 2);
      assert.equal(summary.denominators.catalogue.modelRoutes, 3);
      assert.equal(summary.denominators.catalogue.installedAdapterPackages, 1);
      assert.equal(summary.denominators.matchedModelRoutes, 3);
      assert.equal(summary.denominators.returnedModelRoutes, 0);
      assert.deepEqual(summary.items, []);
      assert.equal(summary.coverage.routeAvailability, "not-observed");

      const listResult = await modelsCommandHandler({
        command: "models",
        args: ["list", "--capability", "reasoning", "--max-items", "1"],
        repositoryRoot,
      });
      const list = listResult.output as Record<string, any>;
      assert.equal(list.denominators.matchedModelRoutes, 2);
      assert.equal(list.denominators.returnedModelRoutes, 1);
      assert.deepEqual(list.truncation, { maxItems: 1, matchedItems: 2, returnedItems: 1, truncated: true });
      assert.equal(list.items[0].providerRoute, "alpha-direct");
      assert.equal(list.items[0].model.route.model, "alpha-zero");
      assert.deepEqual(list.items[0].adapter, { package: "@ai-sdk/alpha", installedVersion: "1.2.3" });

      await writeFile(join(repositoryRoot, "node_modules/@ai-sdk/alpha/package.json"), JSON.stringify({
        name: "@ai-sdk/alpha",
        version: "9.9.9",
      }));
      const replayedResult = await modelsCommandHandler({ command: "models", args: ["list", "--adapter", "installed", "--max-items", "1"], repositoryRoot });
      const replayed = replayedResult.output as Record<string, any>;
      assert.equal(replayed.source.normalizedDigest, summary.source.normalizedDigest);
      assert.deepEqual(replayed.items[0].adapter, { package: "@ai-sdk/alpha", installedVersion: "1.2.3" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("models refresh is the sole fixed-origin network path and writes atomically with mode 0600", async () => {
  await fixtureRepository(async (repositoryRoot) => {
    const originalFetch = globalThis.fetch;
    let request: { input: string; redirect: RequestRedirect | undefined } | undefined;
    globalThis.fetch = async (input, init) => {
      request = { input: String(input), redirect: init?.redirect };
      return {
        ok: true,
        status: 200,
        redirected: false,
        url: "https://models.dev/api.json",
        headers: new Headers({ "content-type": "application/json", "content-length": String(rawFixture.byteLength) }),
        body: new Response(rawFixture).body,
      } as Response;
    };
    try {
      const result = await modelsCommandHandler({
        command: "models",
        args: ["refresh", "--timeout-ms", "1000", "--max-bytes", "1048576"],
        repositoryRoot,
      });
      const output = result.output as Record<string, any>;
      assert.deepEqual(request, { input: "https://models.dev/api.json", redirect: "error" });
      assert.equal(output.operation, "refresh");
      assert.equal(output.externalContact, true);
      assert.equal(output.source.externalContact, true);
      assert.equal(output.authorityEffect, "writes-ignored-catalogue-snapshot-only");
      assert.equal(JSON.stringify(output).includes("timestamp"), false);
      assert.deepEqual(await readFile(join(repositoryRoot, ".usf/catalog/models-dev.raw.json")), rawFixture);
      assert.equal((await stat(join(repositoryRoot, ".usf/catalog/models-dev.raw.json"))).mode & 0o7777, 0o600);
      const normalizedPath = join(repositoryRoot, ".usf/catalog/models-dev.normalized.json");
      const normalizedBytes = await readFile(normalizedPath);
      const normalizedText = normalizedBytes.toString("utf8");
      assert.equal(canonicalJson(JSON.parse(normalizedText)), normalizedText);
      assert.equal((await stat(normalizedPath)).mode & 0o7777, 0o600);

      globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        redirected: true,
        url: "https://redirect.example/api.json",
        headers: new Headers({ "content-type": "application/json" }),
        body: new Response(rawFixture).body,
      } as Response);
      await assert.rejects(
        async () => modelsCommandHandler({ command: "models", args: ["refresh"], repositoryRoot }),
        (error: unknown) => error instanceof UsfError && error.code === "MODELS_REFRESH_ORIGIN_REFUSED",
      );
      assert.deepEqual(await readFile(join(repositoryRoot, ".usf/catalog/models-dev.raw.json")), rawFixture);
      assert.deepEqual(await readFile(normalizedPath), normalizedBytes);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("models rejects unsafe local state and ambiguous command arguments", async () => {
  await fixtureRepository(async (repositoryRoot) => {
    await chmod(join(repositoryRoot, ".usf/catalog/models-dev.raw.json"), 0o644);
    await assert.rejects(
      async () => modelsCommandHandler({ command: "models", args: ["summary"], repositoryRoot }),
      (error: unknown) => error instanceof UsfError && error.code === "MODELS_CATALOGUE_REFUSED",
    );
    await chmod(join(repositoryRoot, ".usf/catalog/models-dev.raw.json"), 0o600);
    await writeFile(join(repositoryRoot, ".usf/catalog/models-dev.normalized.json"), "{}", { mode: 0o600 });
    await chmod(join(repositoryRoot, ".usf/catalog/models-dev.normalized.json"), 0o600);
    await assert.rejects(
      async () => modelsCommandHandler({ command: "models", args: ["summary"], repositoryRoot }),
      (error: unknown) => error instanceof UsfError && error.code === "MODELS_CATALOGUE_PAIR_INVALID",
    );
    await assert.rejects(
      async () => modelsCommandHandler({ command: "models", args: ["list", "--max-items", "0"], repositoryRoot }),
      (error: unknown) => error instanceof UsfError && error.code === "MODELS_ARGUMENTS_INVALID",
    );
  });
});

const doctorProviderConfig = {
  $schema: "urn:usf:providers:1",
  catalogueSource: "models.dev",
  routes: [{
    id: "alpha-primary",
    family: "alpha",
    provider: "alpha",
    adapterPackage: "@ai-sdk/alpha",
    credentialName: "ALPHA_TOKEN",
    model: "alpha-zero",
    capabilities: ["reasoning"],
    privacy: ["public"],
    cost: "free-quota",
    entitlement: "free-quota",
    paidFallback: false,
    concurrency: 2,
    probeFreshnessSeconds: 900,
  }],
};
const doctorPolicy = {
  $schema: "urn:usf:policy:1",
  maximumPaidCost: 0,
  paidFallback: "prohibited",
  unknownPrice: "ineligible",
  acceptedCostClasses: ["local", "zero-price", "free-quota"],
};
const doctorPrivacy = {
  $schema: "urn:usf:privacy:1",
  defaultClassification: "restricted",
  classifications: ["public", "private-metadata", "private-source", "restricted"],
  externalRouteDefault: ["public"],
  restrictedRoutes: ["local"],
};

async function doctorRepository(run: (repositoryRoot: string) => Promise<void>): Promise<void> {
  const repositoryRoot = await privateTemporaryDirectory("usf-doctor-command-");
  try {
    await mkdir(join(repositoryRoot, ".usf/home"), { recursive: true, mode: 0o700 });
    await mkdir(join(repositoryRoot, ".usf/catalog"), { recursive: true, mode: 0o700 });
    await chmod(join(repositoryRoot, ".usf"), 0o700);
    await chmod(join(repositoryRoot, ".usf/home"), 0o700);
    await chmod(join(repositoryRoot, ".usf/catalog"), 0o700);
    await mkdir(join(repositoryRoot, "config"));
    await writeFile(join(repositoryRoot, "config/providers.json"), JSON.stringify(doctorProviderConfig));
    await writeFile(join(repositoryRoot, "config/policy.json"), JSON.stringify(doctorPolicy));
    await writeFile(join(repositoryRoot, "config/privacy.json"), JSON.stringify(doctorPrivacy));
    const frozen = normalizeModelsDevCatalogue(rawFixture, {
      installedAdapters: { "@ai-sdk/alpha": "1.2.3" },
    });
    await writeFile(join(repositoryRoot, ".usf/catalog/models-dev.raw.json"), rawFixture, { mode: 0o600 });
    await writeFile(
      join(repositoryRoot, ".usf/catalog/models-dev.normalized.json"),
      canonicalJson(frozen),
      { mode: 0o600 },
    );
    await chmod(join(repositoryRoot, ".usf/catalog/models-dev.raw.json"), 0o600);
    await chmod(join(repositoryRoot, ".usf/catalog/models-dev.normalized.json"), 0o600);
    await writeFile(join(repositoryRoot, "package.json"), JSON.stringify({
      name: "doctor-command-fixture",
      private: true,
      dependencies: { "@ai-sdk/alpha": "1.2.3" },
    }));
    await mkdir(join(repositoryRoot, "node_modules/@ai-sdk/alpha"), { recursive: true });
    await writeFile(join(repositoryRoot, "node_modules/@ai-sdk/alpha/package.json"), JSON.stringify({
      name: "@ai-sdk/alpha",
      version: "1.2.3",
    }));
    execFileSync("git", ["init", "-q"], { cwd: repositoryRoot });
    execFileSync("git", ["add", "--", "config/providers.json", "config/policy.json", "config/privacy.json"], { cwd: repositoryRoot });
    await run(repositoryRoot);
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
}

test("doctor deterministically reports exact local digests without contact or eligibility", async () => {
  await doctorRepository(async (repositoryRoot) => {
    const originalFetch = globalThis.fetch;
    let contacted = false;
    globalThis.fetch = async () => {
      contacted = true;
      throw new Error("doctor must not contact a provider or catalogue");
    };
    try {
      const request = { command: "doctor" as const, args: [] as const, repositoryRoot };
      const first = await doctorCommandHandler(request);
      const second = await doctorCommandHandler(request);
      assert.deepEqual(first, second);
      assert.equal(contacted, false);
      assert.equal(first.exitCode, 0);
      const output = first.output as Record<string, any>;
      assert.equal(output.schema, "urn:usf:doctor-result:1");
      assert.equal(output.status, "ok");
      assert.equal(output.externalContact, false);
      assert.equal(output.authorityEffect, "none");
      assert.equal(output.providerConfig.rawDigest, sha256(await readFile(join(repositoryRoot, "config/providers.json"))));
      assert.equal(output.policy.rawDigest, sha256(await readFile(join(repositoryRoot, "config/policy.json"))));
      assert.equal(output.privacy.rawDigest, sha256(await readFile(join(repositoryRoot, "config/privacy.json"))));
      assert.equal(output.catalogue.rawDigest, sha256(rawFixture));
      assert.match(output.catalogue.normalizedDigest, /^sha256:[a-f0-9]{64}$/u);
      assert.deepEqual(output.catalogue.validity, { state: "valid", reasonCode: null });
      assert.deepEqual(output.catalogue.freshness, { state: "not-observed", basis: "no-trusted-acquisition-time" });
      assert.deepEqual(output.adapters, [{ package: "@ai-sdk/alpha", configuredRoutes: 1, installedVersion: "1.2.3" }]);
      assert.deepEqual(output.credentials, {
        source: "not-selected",
        credentials: [{ name: "ALPHA_TOKEN", present: false }],
        valuesExposed: false,
      });
      assert.deepEqual(output.providerHome, { contained: true, private: true });
      assert.equal(output.providerHealth, "not-observed");
      assert.equal(output.eligibility, "not-evaluated");
      assert.equal(JSON.stringify(output).includes(repositoryRoot), false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("doctor accepts only an explicit secure untracked env and exposes presence metadata", async () => {
  await doctorRepository(async (repositoryRoot) => {
    const externalRoot = await privateTemporaryDirectory("usf-doctor-env-");
    try {
      const externalEnv = join(externalRoot, "provider.env");
      await writeFile(externalEnv, "ALPHA_TOKEN=private-value\nOTHER_SECRET=ignored-value\n", { mode: 0o600 });
      await chmod(externalEnv, 0o600);
      const result = await doctorCommandHandler({
        command: "doctor",
        args: ["--env-file", externalEnv],
        repositoryRoot,
      });
      const output = result.output as Record<string, any>;
      assert.deepEqual(output.credentials, {
        source: "explicit-file",
        credentials: [{ name: "ALPHA_TOKEN", present: true }],
        valuesExposed: false,
      });
      const serialized = JSON.stringify(output);
      assert.doesNotMatch(serialized, /private-value|ignored-value/u);
      assert.equal(serialized.includes(externalEnv), false);
      assert.equal(serialized.includes(externalRoot), false);

      execFileSync("git", ["init", "-q"], { cwd: externalRoot });
      execFileSync("git", ["add", "--", "provider.env"], { cwd: externalRoot });
      await assert.rejects(
        async () => doctorCommandHandler({ command: "doctor", args: ["--env-file", externalEnv], repositoryRoot }),
        (error: unknown) => error instanceof UsfError && error.code === "DOCTOR_ENV_FILE_TRACKED",
      );

      const trackedEnv = join(repositoryRoot, "tracked.env");
      await writeFile(trackedEnv, "ALPHA_TOKEN=tracked-value\n", { mode: 0o600 });
      await chmod(trackedEnv, 0o600);
      execFileSync("git", ["add", "--", "tracked.env"], { cwd: repositoryRoot });
      await assert.rejects(
        async () => doctorCommandHandler({ command: "doctor", args: ["--env-file", trackedEnv], repositoryRoot }),
        (error: unknown) => error instanceof UsfError && error.code === "DOCTOR_ENV_FILE_TRACKED",
      );
    } finally {
      await rm(externalRoot, { recursive: true, force: true });
    }
  });
});

test("doctor reports invalid tracked policy but refuses unsafe or live-health inputs", async () => {
  await doctorRepository(async (repositoryRoot) => {
    const invalidPolicy = Buffer.from(JSON.stringify({ ...doctorPolicy, maximumPaidCost: 1 }));
    await writeFile(join(repositoryRoot, "config/policy.json"), invalidPolicy);
    const degraded = await doctorCommandHandler({ command: "doctor", args: [], repositoryRoot });
    assert.equal(degraded.exitCode, 4);
    const output = degraded.output as Record<string, any>;
    assert.equal(output.status, "degraded");
    assert.equal(output.policy.rawDigest, sha256(invalidPolicy));
    assert.deepEqual(output.policy.validity, { state: "invalid", reasonCode: "DOCTOR_POLICY_INVALID" });
    assert.equal(output.eligibility, "not-evaluated");

    await assert.rejects(
      async () => doctorCommandHandler({ command: "doctor", args: ["--provider-health"], repositoryRoot }),
      (error: unknown) => error instanceof UsfError && error.code === "DOCTOR_PROVIDER_HEALTH_REFUSED",
    );
    await chmod(join(repositoryRoot, ".usf/home"), 0o755);
    await assert.rejects(
      async () => doctorCommandHandler({ command: "doctor", args: [], repositoryRoot }),
      (error: unknown) => error instanceof UsfError && error.code === "DOCTOR_PROVIDER_HOME_REFUSED",
    );
  });
});

test("doctor degrades when the frozen catalogue pair is missing or mismatched", async () => {
  await doctorRepository(async (repositoryRoot) => {
    const normalizedPath = join(repositoryRoot, ".usf/catalog/models-dev.normalized.json");
    const normalizedBytes = await readFile(normalizedPath);

    await rm(normalizedPath);
    const missing = await doctorCommandHandler({ command: "doctor", args: [], repositoryRoot });
    assert.equal(missing.exitCode, 4);
    const missingOutput = missing.output as Record<string, any>;
    assert.equal(missingOutput.status, "degraded");
    assert.deepEqual(missingOutput.catalogue, {
      availability: "not-observed",
      rawDigest: null,
      normalizedDigest: null,
      validity: { state: "invalid", reasonCode: "DOCTOR_CATALOGUE_PAIR_MISSING" },
      freshness: { state: "not-observed", basis: "no-trusted-acquisition-time" },
    });

    await writeFile(normalizedPath, normalizedBytes, { mode: 0o600 });
    await chmod(normalizedPath, 0o600);
    const mismatched = JSON.parse(normalizedBytes.toString("utf8")) as Record<string, unknown>;
    mismatched.rawDigest = `sha256:${"0".repeat(64)}`;
    await writeFile(normalizedPath, canonicalJson(mismatched), { mode: 0o600 });
    await chmod(normalizedPath, 0o600);
    const invalid = await doctorCommandHandler({ command: "doctor", args: [], repositoryRoot });
    assert.equal(invalid.exitCode, 4);
    const invalidOutput = invalid.output as Record<string, any>;
    assert.equal(invalidOutput.status, "degraded");
    assert.deepEqual(invalidOutput.catalogue, {
      availability: "available",
      rawDigest: null,
      normalizedDigest: null,
      validity: { state: "invalid", reasonCode: "DOCTOR_CATALOGUE_PAIR_INVALID" },
      freshness: { state: "not-observed", basis: "no-trusted-acquisition-time" },
    });
    assert.equal(JSON.stringify(invalidOutput).includes(repositoryRoot), false);
    assert.equal(JSON.stringify(missingOutput).includes(repositoryRoot), false);
  });
});

test("doctor isolates local Git children from hostile controls, secrets and PATH shims", async () => {
  await doctorRepository(async (repositoryRoot) => {
    const shimRoot = join(repositoryRoot, ".usf", "git-shim");
    const shimPath = join(shimRoot, "git");
    const markerPath = join(repositoryRoot, ".usf", "git-shim-called");
    const envPath = join(repositoryRoot, ".usf", "provider.env");
    await mkdir(shimRoot, { mode: 0o700 });
    await writeFile(envPath, "ALPHA_TOKEN=private-value\n", { mode: 0o600 });
    await chmod(envPath, 0o600);
    await writeFile(shimPath, [
      "#!/bin/sh",
      `printf 'called\\n' >> '${markerPath}'`,
      "exit 97",
      "",
    ].join("\n"), { mode: 0o700 });
    await chmod(shimPath, 0o700);

    const original = {
      PATH: process.env.PATH,
      GIT_DIR: process.env.GIT_DIR,
      GIT_INDEX_FILE: process.env.GIT_INDEX_FILE,
      USF_DOCTOR_SECRET_CANARY: process.env.USF_DOCTOR_SECRET_CANARY,
    };
    process.env.PATH = `${shimRoot}:${original.PATH ?? "/usr/bin:/bin"}`;
    process.env.GIT_DIR = join(repositoryRoot, ".git-hostile");
    process.env.GIT_INDEX_FILE = join(repositoryRoot, ".git-index-hostile");
    process.env.USF_DOCTOR_SECRET_CANARY = "doctor-secret-canary-value";
    try {
      const result = await doctorCommandHandler({
        command: "doctor",
        args: ["--env-file", envPath],
        repositoryRoot,
      });
      assert.equal(result.exitCode, 0);
      const output = result.output as Record<string, any>;
      assert.equal(output.status, "ok");
      await assert.rejects(stat(markerPath), { code: "ENOENT" });
      assert.equal(JSON.stringify(output).includes("doctor-secret-canary-value"), false);
      assert.equal(JSON.stringify(output).includes(repositoryRoot), false);
    } finally {
      for (const [name, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});

test("route refuses in-repository symlinks for input and indexed qualification authority", async () => {
  const repositoryRoot = await privateTemporaryDirectory("usf-route-authority-");
  try {
    await mkdir(join(repositoryRoot, "config"), { mode: 0o700 });
    await mkdir(join(repositoryRoot, ".usf/inputs"), { recursive: true, mode: 0o700 });
    const authorityPath = join(repositoryRoot, "config/qualification.json");
    const targetPath = join(repositoryRoot, ".usf/authority.json");
    const inputPath = join(repositoryRoot, ".usf/inputs/route.json");
    const inputTargetPath = join(repositoryRoot, ".usf/route-target.json");
    await writeFile(authorityPath, "{}\n", { mode: 0o600 });
    await writeFile(targetPath, "{}\n", { mode: 0o600 });
    await writeFile(inputPath, JSON.stringify({ installedAdapters: [], credentialNamesPresent: [] }), { mode: 0o600 });
    await writeFile(inputTargetPath, JSON.stringify({ installedAdapters: [], credentialNamesPresent: [] }), { mode: 0o600 });
    await chmod(inputPath, 0o600);
    execFileSync("/usr/bin/git", ["init", "-q", repositoryRoot]);
    execFileSync("/usr/bin/git", ["-C", repositoryRoot, "add", "--", "config/qualification.json"]);

    await unlink(inputPath);
    await symlink("../route-target.json", inputPath);
    await assert.rejects(
      async () => routeCommandHandler({ command: "route", args: ["--input", ".usf/inputs/route.json"], repositoryRoot }),
      (error: unknown) => error instanceof UsfError && error.code === "ROUTE_INPUT_REFUSED" && error.exitCode === 5,
    );
    await unlink(inputPath);
    await writeFile(inputPath, JSON.stringify({ installedAdapters: [], credentialNamesPresent: [] }), { mode: 0o600 });
    await chmod(inputPath, 0o600);

    await unlink(authorityPath);
    await symlink("../.usf/authority.json", authorityPath);

    await assert.rejects(
      async () => routeCommandHandler({ command: "route", args: ["--input", ".usf/inputs/route.json"], repositoryRoot }),
      (error: unknown) => error instanceof UsfError && error.code === "ROUTE_QUALIFICATION_AUTHORITY_REFUSED" && error.exitCode === 5,
    );
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});
