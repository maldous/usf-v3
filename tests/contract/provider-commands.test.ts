import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { doctorCommandHandler } from "../../src/commands/doctor.ts";
import { modelsCommandHandler } from "../../src/commands/models.ts";
import { providersCommandHandler } from "../../src/commands/providers.ts";
import { routeCommandHandler } from "../../src/commands/route.ts";
import { canonicalJson, sha256 } from "../../src/core/canonical.ts";
import { UsfError } from "../../src/core/errors.ts";
import { loadSemanticGraph } from "../../src/graph/index.ts";
import { deriveWork } from "../../src/graph/work.ts";
import { normalizeModelsDevCatalogue } from "../../src/providers/catalogue.ts";
import { createJsonSchemaValidator } from "../../src/schema/index.ts";

const rawFixture = await readFile(fileURLToPath(new URL("../fixtures/providers/models-dev.json", import.meta.url)));
const legacyProviderFixture = await readFile(fileURLToPath(new URL("../../config/provider-legacy-observations.json", import.meta.url)));
const providerCensusValidator = createJsonSchemaValidator(JSON.parse(
  await readFile(fileURLToPath(new URL("../../schemas/provider-census-result.schema.json", import.meta.url)), "utf8"),
));
const workspaceTemporaryRoot = resolve(process.env.TMPDIR ?? fileURLToPath(new URL("../../.usf/tmp/", import.meta.url)));

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
    provider: "alpha-direct",
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

async function doctorRepository(run: (repositoryRoot: string) => Promise<void>, initializeGit = true): Promise<void> {
  const repositoryRoot = await privateTemporaryDirectory("usf-doctor-command-");
  try {
    await mkdir(join(repositoryRoot, ".usf/home"), { recursive: true, mode: 0o700 });
    await mkdir(join(repositoryRoot, ".usf/catalog"), { recursive: true, mode: 0o700 });
    await chmod(join(repositoryRoot, ".usf"), 0o700);
    await chmod(join(repositoryRoot, ".usf/home"), 0o700);
    await chmod(join(repositoryRoot, ".usf/catalog"), 0o700);
    await mkdir(join(repositoryRoot, "config"));
    await writeFile(join(repositoryRoot, "config/providers.json"), JSON.stringify(doctorProviderConfig));
    await writeFile(join(repositoryRoot, "config/provider-legacy-observations.json"), legacyProviderFixture);
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
    if (initializeGit) {
      execFileSync("git", ["init", "-q"], { cwd: repositoryRoot });
      execFileSync("git", ["add", "--", "config/provider-legacy-observations.json", "config/providers.json", "config/policy.json", "config/privacy.json"], { cwd: repositoryRoot });
    }
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

test("providers projects a bounded no-contact census, exact status and reviewed aliases", async () => {
  await doctorRepository(async (repositoryRoot) => {
    const externalRoot = await privateTemporaryDirectory("usf-providers-env-");
    const originalFetch = globalThis.fetch;
    let contacted = false;
    globalThis.fetch = async () => {
      contacted = true;
      throw new Error("providers must not contact a provider or catalogue");
    };
    try {
      const externalEnv = join(externalRoot, "provider.env");
      await writeFile(externalEnv, "ALPHA_TOKEN=private-value\nOTHER_SECRET=ignored-value\n", { mode: 0o600 });
      await chmod(externalEnv, 0o600);

      const censusResult = await providersCommandHandler({
        command: "providers",
        args: ["census", "--env-file", externalEnv, "--max-items", "2"],
        repositoryRoot,
      });
      const census = censusResult.output as Record<string, any>;
      assert.equal(census.schema, "urn:usf:provider-census-result:1");
      assert.equal(census.operation, "census");
      assert.equal(census.externalContact, false);
      assert.equal(census.authorityEffect, "none");
      assert.equal(providerCensusValidator.validate(census).valid, true);
      assert.equal(census.source.credentialSource, "explicit-file");
      assert.equal(census.source.legacyCredentialSetDigest, JSON.parse(legacyProviderFixture.toString("utf8")).credentialNameProvenance.projectionDigest);
      assert.match(census.source.legacyCredentialSetDigest, /^sha256:[0-9a-f]{64}$/u);
      assert.match(census.source.hostTransportSetDigest, /^sha256:[0-9a-f]{64}$/u);
      assert.match(census.source.legacyProviderObservationSetDigest, /^sha256:[0-9a-f]{64}$/u);
      assert.equal(census.denominators.catalogueProviderRoutes, 2);
      assert.equal(census.denominators.catalogueModelRoutes, 3);
      assert.equal(census.denominators.configuredRoutes, 1);
      assert.equal(census.denominators.reviewedLegacyCredentialNames, 24);
      assert.equal(census.denominators.reviewedLegacyProviderObservations, 7);
      assert.equal(census.denominators.hostTransports, 3);
      assert.deepEqual(census.truncation, { maxItems: 2, matchedItems: 11, returnedItems: 2, truncated: true });
      assert.deepEqual(census.items[0], {
        kind: "configured-route",
        id: "alpha-primary",
        providerFamily: "alpha",
        provider: "alpha-direct",
        providerRoute: "alpha-direct",
        requestedModel: "alpha-zero",
        routeModel: "alpha-zero",
        underlyingFamily: "alpha-family",
        underlyingModel: "alpha-zero",
        adapterPackage: "@ai-sdk/alpha",
        adapterInstalledVersion: null,
        adapterLockDigest: null,
        credentialName: "ALPHA_TOKEN",
        credentialPresent: true,
        catalogueIdentity: "exact",
        capabilities: { configured: ["reasoning"], catalogue: ["attachment", "reasoning", "structured-output", "tool-call"] },
        economics: { declaredCost: "free-quota", declaredEntitlement: "free-quota", paidFallback: false, accountTierReceipt: "missing", status: "unverified" },
        availability: "unknown",
        qualification: "UNQUALIFIED",
        allocation: "excluded",
        exclusionReasons: ["ACCOUNT_RECEIPT_MISSING", "ADAPTER_UNAVAILABLE", "AUTHENTICATED_ANSWER_MISSING", "HIDDEN_HOLDOUT_MISSING", "UNQUALIFIED"],
        sourceProvenance: ["models.dev", "v3-config"],
      });
      const serialized = JSON.stringify(census);
      assert.doesNotMatch(serialized, /private-value|ignored-value/u);
      assert.equal(serialized.includes(externalEnv), false);
      assert.equal(serialized.includes(externalRoot), false);

      const status = (await providersCommandHandler({
        command: "providers",
        args: ["status", "--route", "alpha-primary", "--env-file", externalEnv],
        repositoryRoot,
      })).output as Record<string, any>;
      assert.equal(status.operation, "status");
      assert.equal(status.truncation.matchedItems, 1);
      assert.equal(status.items[0].id, "alpha-primary");

      const aliases = (await providersCommandHandler({
        command: "providers",
        args: ["aliases", "--credential-name", "ZAI_API_KEY"],
        repositoryRoot,
      })).output as Record<string, any>;
      assert.equal(aliases.operation, "aliases");
      assert.equal(providerCensusValidator.validate(aliases).valid, true);
      assert.deepEqual(aliases.items, [{
        kind: "identity-alias",
        id: "credential:ZAI_API_KEY",
        aliasKind: "legacy-credential",
        sourceIdentity: "ZAI_API_KEY",
        targetIdentities: ["ZHIPU_API_KEY"],
        mappingStatus: "unresolved",
        scope: "provider-candidate",
        sourceProvenance: ["models.dev", "reviewed-v2-environment-name"],
        nonClaim: "credential-name-mapping-is-not-entitlement-or-secret-evidence",
      }]);

      const host = (await providersCommandHandler({
        command: "providers",
        args: ["status", "--transport", "claude-cli"],
        repositoryRoot,
      })).output as Record<string, any>;
      assert.equal(host.items[0].transport, "claude-cli");
      assert.equal(host.items[0].actualModel, null);
      assert.equal(host.items[0].qualification, "UNQUALIFIED");

      await assert.rejects(
        async () => providersCommandHandler({ command: "providers", args: ["census", "--max-items", "1", "--max-items", "2"], repositoryRoot }),
        (error: unknown) => error instanceof UsfError && error.code === "PROVIDERS_ARGUMENTS_INVALID",
      );
      await assert.rejects(
        async () => providersCommandHandler({ command: "providers", args: ["aliases", "--env-file", externalEnv], repositoryRoot }),
        (error: unknown) => error instanceof UsfError && error.code === "PROVIDERS_ARGUMENTS_INVALID",
      );
      assert.equal(contacted, false);
    } finally {
      globalThis.fetch = originalFetch;
      await rm(externalRoot, { recursive: true, force: true });
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

test("provider graph separates fixture capabilities from route-keyed operational state", async () => {
  const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
  const graph = loadSemanticGraph(repositoryRoot, "graph/manifests/self-host-provider-v3.json");
  const quads = graph.quads;
  const predicate = (localName: string) => `urn:usf:predicate:${localName}`;
  const objects = (subject: string, localName: string) => quads
    .filter((quad) => quad.subject === subject && quad.predicate === predicate(localName))
    .map((quad) => quad.object);
  const subjectsOfType = (type: string) => new Set(quads
    .filter((quad) => quad.predicate === predicate("type") && quad.object === type)
    .map((quad) => quad.subject));

  const workPackets = subjectsOfType("urn:usf:type:WorkPacket");
  const selected = deriveWork(graph, { profile: "urn:usf:profile:v3-self-host:3", maxItems: 100 });
  assert.equal(selected.status, "ok", selected.reasonCode);
  const selectedPackets = new Map((selected.items ?? []).map((packet) => [packet.id, packet]));
  const allWorks = (selected.items ?? []).map((packet) => packet.id).sort();
  assert.deepEqual(allWorks, [
    "urn:usf:work:file-asset-index",
    "urn:usf:work:operator-observability",
    "urn:usf:work:provider-account-tier-receipt",
    "urn:usf:work:provider-census",
    "urn:usf:work:provider-hidden-holdout",
    "urn:usf:work:provider-invocation-boundary",
    "urn:usf:work:provider-parallel-execution",
    "urn:usf:work:provider-semantic-qualification-v2",
    "urn:usf:work:repository-path-scope",
  ]);
  const providerWorks = allWorks.filter((subject) => subject.startsWith("urn:usf:work:provider-"));
  assert.deepEqual(providerWorks.sort(), [
    "urn:usf:work:provider-account-tier-receipt",
    "urn:usf:work:provider-census",
    "urn:usf:work:provider-hidden-holdout",
    "urn:usf:work:provider-invocation-boundary",
    "urn:usf:work:provider-parallel-execution",
    "urn:usf:work:provider-semantic-qualification-v2",
  ]);

  const currentnessPredicates = ["readPath", "writePath", "policyPath", "schemaPath", "toolPath"];
  const ancestors = (work: string, seen = new Set<string>()): Set<string> => {
    for (const dependency of objects(work, "dependsOn")) {
      if (!seen.has(dependency)) {
        seen.add(dependency);
        ancestors(dependency, seen);
      }
    }
    return seen;
  };
  for (const work of providerWorks) {
    assert.deepEqual(objects(work, "externalContact"), ["false"]);
    for (const validation of objects(work, "validation")) {
      assert.deepEqual(objects(validation, "executionMode"), ["urn:usf:mode:deterministic-test-substitute"]);
    }
  }

  const pathsOverlap = (left: string, right: string): boolean => left === right
    || (left.endsWith("/") && right.startsWith(left))
    || (right.endsWith("/") && left.startsWith(right));
  for (const work of allWorks) {
    const writes = objects(work, "writePath");
    for (const ancestor of ancestors(work)) {
      const ancestorCurrentness = new Set(currentnessPredicates.flatMap((localName) => objects(ancestor, localName)));
      assert.deepEqual(
        writes.filter((path) => [...ancestorCurrentness].some((ancestorPath) => pathsOverlap(path, ancestorPath))),
        [],
        `${work} rewrites currentness of ${ancestor}`,
      );
    }
  }

  for (let leftIndex = 0; leftIndex < allWorks.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < allWorks.length; rightIndex += 1) {
      const left = allWorks[leftIndex]!;
      const right = allWorks[rightIndex]!;
      const leftWrites = objects(left, "writePath");
      const rightWrites = objects(right, "writePath");
      assert.deepEqual(
        leftWrites.filter((path) => rightWrites.some((rightPath) => pathsOverlap(path, rightPath))),
        [],
        `${left} and ${right} own overlapping write paths in the exact profile-selected work set`,
      );
      const leftCurrentness = currentnessPredicates.flatMap((localName) => objects(left, localName));
      const rightCurrentness = currentnessPredicates.flatMap((localName) => objects(right, localName));
      const leftProducesForRight = leftWrites.filter((path) => rightCurrentness.some((rightPath) => pathsOverlap(path, rightPath)));
      const rightProducesForLeft = rightWrites.filter((path) => leftCurrentness.some((leftPath) => pathsOverlap(path, leftPath)));
      if (leftProducesForRight.length > 0) {
        assert.equal(ancestors(right).has(left), true, `${right} consumes ${left} without a dependency edge`);
      }
      if (rightProducesForLeft.length > 0) {
        assert.equal(ancestors(left).has(right), true, `${left} consumes ${right} without a dependency edge`);
      }
    }
  }

  for (const [work, forbiddenPaths] of [
    ["urn:usf:work:provider-account-tier-receipt", ["config/providers.json"]],
    ["urn:usf:work:provider-invocation-boundary", ["config/qualification.json", "package.json", "pnpm-lock.yaml"]],
    ["urn:usf:work:provider-hidden-holdout", ["config/qualification.json"]],
    ["urn:usf:work:provider-parallel-execution", ["config/providers.json", "package.json", "pnpm-lock.yaml"]],
  ] as const) {
    const operationalInputs = new Set([
      ...objects(work, "writePath"),
      ...objects(work, "toolPath"),
      ...(work === "urn:usf:work:provider-hidden-holdout" ? [] : objects(work, "readPath")),
    ]);
    assert.deepEqual(forbiddenPaths.filter((path) => operationalInputs.has(path)), [], work);
  }

  const stages = [
    "urn:usf:provider-stage:account-source-authorization:1",
    "urn:usf:provider-stage:account-receipt:1",
    "urn:usf:provider-stage:adapter-preflight:1",
    "urn:usf:provider-stage:run-authorization:1",
    "urn:usf:provider-stage:provider-answer:1",
    "urn:usf:provider-stage:hidden-evaluation:1",
    "urn:usf:provider-stage:route-qualification:1",
  ];
  // Order comes from the declared sequenceIndex, not from quad order. N-Quads is
  // an unordered set and the transaction writer canonicalises by sorting, so a
  // test that reads order from iteration asserts a property the format does not
  // provide -- it passed only while the file happened to be in pipeline order.
  const sequenced = [...objects("urn:usf:provider-operation:qualification-sequence:1", "stage")]
    .sort((left, right) => Number(objects(left, "sequenceIndex")[0]) - Number(objects(right, "sequenceIndex")[0]));
  assert.deepEqual(sequenced, stages);
  // Every stage in the sequence must actually declare an index, or the sort above
  // would silently degrade to the iteration order it exists to replace.
  for (const stage of sequenced) {
    assert.match(objects(stage, "sequenceIndex")[0] ?? "", /^[1-9][0-9]*$/u, stage);
  }
  for (const stage of stages) {
    assert.equal(objects(stage, "type").includes("urn:usf:type:RouteKeyedOperationalStage"), true);
    assert.deepEqual(objects(stage, "repositoryTracking"), ["ignored"]);
    assert.match(objects(stage, "recordPathPattern")[0] ?? "", /^\.usf\/provider-operations\//u);
    assert.equal(objects(stage, "recordSchema").length, 1);
  }
  assert.deepEqual(objects("urn:usf:provider-stage:account-source-authorization:1", "contactClass"), [
    "provider-owned-non-inference-account-source-only",
  ]);
  assert.deepEqual(objects("urn:usf:provider-stage:account-source-authorization:1", "preContactRecheck"), [
    "required-immediately-before-provider-owned-account-source-contact",
  ]);
  assert.deepEqual(objects("urn:usf:provider-stage:run-authorization:1", "preContactRecheck"), [
    "required-immediately-before-adapter-child-contact",
  ]);
  const selectedContracts = new Set(objects("urn:usf:profile:v3-self-host:3", "selectsContract"));
  for (const contract of subjectsOfType("urn:usf:type:OperationalContract")) {
    const implementingWork = objects(contract, "implementedByWork");
    assert.deepEqual(objects(contract, "type").sort(), [
      "urn:usf:type:OperationalContract",
      "urn:usf:type:SemanticContract",
    ]);
    assert.equal(implementingWork.length > 0, true, contract);
    for (const work of implementingWork) {
      assert.equal(allWorks.includes(work), true, contract);
      const primaryContracts = objects(work, "contract");
      assert.equal(primaryContracts.length, 1, `${work} has no exact primary contract`);
      assert.equal(selectedContracts.has(primaryContracts[0]!), true, `${work} is not reachable from the selected profile`);
      assert.equal(objects(work, "implementsContract").includes(contract), true, `${work} does not bind ${contract}`);
      assert.equal(
        selectedPackets.get(work)?.semanticDependencies.some((dependency) => dependency.kind === "semantic-resource" && dependency.key === contract),
        true,
        `${work} does not consume ${contract} in its scoped semantic basis`,
      );
    }
    for (const outputSchema of objects(contract, "operationalOutputSchema")) {
      const schemaPaths = objects(outputSchema, "schemaPath");
      assert.equal(schemaPaths.length, 1, outputSchema);
      assert.equal(
        implementingWork.some((work) => objects(work, "writePath").some((path) => pathsOverlap(path, schemaPaths[0]!))),
        true,
        `${contract} has no implementing work owner for ${schemaPaths[0]}`,
      );
    }
    assert.equal(workPackets.has(contract.replace("urn:usf:contract:", "urn:usf:work:")), false);
    assert.deepEqual(objects(contract, "environmentApplicability"), [
      "urn:usf:environment-applicability:provider-pipeline:localdev",
    ]);
    assert.equal(objects(contract, "realisationPermission").length, 1, contract);
    assert.equal(objects(contract, "completionEvidenceRequirement").length, 1, contract);
    assert.equal(objects(contract, "completionProofObligation").length, 1, contract);
  }
  assert.deepEqual(objects("urn:usf:provider-operation:account-source-protocol:1", "refuses").sort(), [
    "caller-submitted-receipt",
    "metrics-or-headers-without-paid-overage-hard-cap-evidence",
    "self-authored-receipt-digest",
  ]);
  const providerRegistryReservation = "urn:usf:requirement:operator-provider-command-reservation";
  assert.deepEqual(objects(providerRegistryReservation, "ownerWork"), ["urn:usf:work:operator-observability"]);
  assert.deepEqual(objects(providerRegistryReservation, "cliPath"), ["src/cli.ts"]);
  assert.deepEqual(objects(providerRegistryReservation, "dispatcherPath"), ["src/commands/dispatcher.ts"]);
  assert.deepEqual(objects(providerRegistryReservation, "helpPath"), ["src/commands/help.ts"]);
  assert.deepEqual(objects(providerRegistryReservation, "providerRegistryPath"), ["src/commands/providers.ts"]);
  assert.deepEqual(objects(providerRegistryReservation, "registryRoot"), ["providers"]);
  assert.deepEqual(objects(providerRegistryReservation, "closed"), ["true"]);
  assert.deepEqual(objects(providerRegistryReservation, "leafImplementationMayRewriteOwnerPath"), ["false"]);
  assert.deepEqual(objects(providerRegistryReservation, "reservedCommandPath").sort(), [
    "providers aliases",
    "providers census",
    "providers host",
    "providers host census",
    "providers receipt",
    "providers receipt acquire",
    "providers receipt verify",
    "providers status",
  ]);
  const receiptCommand = "urn:usf:command:providers-receipt:1";
  assert.equal(objects(receiptCommand, "type").includes("urn:usf:type:RegisteredCliCommand"), true);
  assert.deepEqual(objects(receiptCommand, "availability"), ["registered"]);
  assert.deepEqual(objects(receiptCommand, "implementationState"), ["urn:usf:implementation-state:proofblocked"]);
  assert.deepEqual(objects(receiptCommand, "handlerPath"), ["src/commands/provider-receipts.ts"]);
  assert.deepEqual(objects(receiptCommand, "registryPath"), ["src/commands/providers.ts"]);
  assert.deepEqual(objects(receiptCommand, "helpPath"), ["src/commands/help.ts"]);
  assert.deepEqual(objects(receiptCommand, "registryReservation"), [providerRegistryReservation]);
  assert.deepEqual(objects(receiptCommand, "refusalCode"), ["PROVIDERS_RECEIPT_PROOFBLOCKED"]);
  assert.deepEqual(objects("urn:usf:contract:provider-account-tier-receipt:1", "registeredCommand"), [receiptCommand]);
  assert.deepEqual(objects("urn:usf:command:providers-host-census:1", "registryReservation"), [providerRegistryReservation]);
  for (const policy of [
    "urn:usf:publication-policy:provider-pipeline-construction-authority:1",
    "urn:usf:publication-policy:provider-pipeline-no-change-completion:1",
  ]) {
    assert.equal(objects(policy, "eligibleWork").includes("urn:usf:work:provider-account-tier-receipt"), true, policy);
  }

  const openRouterMapping = "urn:usf:provider-operation:account-source:openrouter-current-key:1";
  assert.deepEqual(objects("urn:usf:provider-operation:account-source-protocol:1", "candidateMapping"), [openRouterMapping]);
  assert.deepEqual(objects(openRouterMapping, "type"), ["urn:usf:type:ProviderAccountSourceMapping"]);
  assert.deepEqual(objects(openRouterMapping, "endpointIdentity"), ["https://openrouter.ai/api/v1/key"]);
  assert.deepEqual(objects(openRouterMapping, "method"), ["GET"]);
  assert.deepEqual(objects(openRouterMapping, "credentialName"), ["OPENROUTER_API_KEY"]);
  assert.equal(objects(openRouterMapping, "mapsField").length, 6);
  assert.deepEqual(objects(openRouterMapping, "mappingDisposition"), ["insufficient-alone-for-zero-paid-account-receipt"]);
  assert.equal(objects(openRouterMapping, "missingRequiredEvidence").length, 4);
  assert.match(objects(openRouterMapping, "nonClaim")[0] ?? "", /does not configure an OpenRouter route/u);
  for (const requirement of [
    "urn:usf:requirement:provider-pipeline-provider-posture",
    "urn:usf:requirement:provider-pipeline-port-isolation",
    "urn:usf:requirement:provider-pipeline-metering-quota",
    "urn:usf:requirement:provider-pipeline-transport-resilience",
  ]) {
    assert.deepEqual(objects(requirement, "type"), ["urn:usf:type:Requirement"]);
  }
  assert.equal(
    objects("urn:usf:contract:provider-adapter-preflight:1", "requires")
      .includes("urn:usf:requirement:provider-pipeline-port-isolation"),
    true,
  );
  for (const schema of [
    "urn:usf:account-source-authorization:1",
    "urn:usf:account-tier-receipt:1",
    "urn:usf:adapter-preflight-receipt:1",
    "urn:usf:run-authorization:1",
    "urn:usf:provider-answer-observation:1",
    "urn:usf:hidden-evaluation-receipt:1",
    "urn:usf:route-qualification-receipt:1",
    "urn:usf:parallel-provider-run:1",
    "urn:usf:semantic-token-comparison:1",
  ]) {
    assert.equal(objects(schema, "type").includes("urn:usf:type:SemanticRecordSchema"), true, schema);
    assert.deepEqual(objects(schema, "closedRecord"), ["true"]);
    assert.equal(objects(schema, "schemaPath").length, 1);
    assert.equal(objects(schema, "contentDigestRule").length, 1);
  }
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
