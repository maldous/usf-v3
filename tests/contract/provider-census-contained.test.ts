import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { providersCommandHandler } from "../../src/commands/providers.ts";
import { canonicalJson } from "../../src/core/canonical.ts";
import { normalizeModelsDevCatalogue } from "../../src/providers/catalogue.ts";
import { createJsonSchemaValidator } from "../../src/schema/index.ts";

const rawFixture = await readFile(fileURLToPath(new URL("../fixtures/providers/models-dev.json", import.meta.url)));
const legacyProviderFixture = await readFile(fileURLToPath(new URL("../../config/provider-legacy-observations.json", import.meta.url)));
const providerCensusValidator = createJsonSchemaValidator(JSON.parse(
  await readFile(fileURLToPath(new URL("../../schemas/provider-census-result.schema.json", import.meta.url)), "utf8"),
));
const temporaryRoot = resolve(process.env.TMPDIR ?? fileURLToPath(new URL("../../.usf/tmp/", import.meta.url)));

const providerConfig = {
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

test("provider-census-contained", async () => {
  await mkdir(temporaryRoot, { recursive: true, mode: 0o700 });
  await chmod(temporaryRoot, 0o700);
  const repositoryRoot = await mkdtemp(join(temporaryRoot, "usf-provider-census-"));
  const originalFetch = globalThis.fetch;
  let contacted = false;
  globalThis.fetch = async () => {
    contacted = true;
    throw new Error("contained provider census must not contact a provider or catalogue");
  };
  try {
    await mkdir(join(repositoryRoot, ".usf/catalog"), { recursive: true, mode: 0o700 });
    await chmod(join(repositoryRoot, ".usf"), 0o700);
    await chmod(join(repositoryRoot, ".usf/catalog"), 0o700);
    await mkdir(join(repositoryRoot, "config"));
    await writeFile(join(repositoryRoot, "config/providers.json"), JSON.stringify(providerConfig));
    await writeFile(join(repositoryRoot, "config/provider-legacy-observations.json"), legacyProviderFixture);
    await writeFile(join(repositoryRoot, "package.json"), JSON.stringify({
      name: "provider-census-contained-fixture",
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

    const result = await providersCommandHandler({
      command: "providers",
      args: ["census", "--max-items", "2"],
      repositoryRoot,
    });
    const output = result.output as Record<string, any>;
    assert.equal(result.exitCode, 0);
    assert.equal(providerCensusValidator.validate(output).valid, true);
    assert.equal(output.status, "ok");
    assert.equal(output.operation, "census");
    assert.equal(output.externalContact, false);
    assert.equal(output.authorityEffect, "none");
    assert.equal(output.semanticScope.status, "not-selected");
    assert.equal(output.source.credentialSource, "not-selected");
    assert.equal(output.denominators.configuredRoutes, 1);
    assert.equal(output.denominators.reviewedLegacyProviderObservations, 7);
    assert.equal(output.truncation.maxItems, 2);
    assert.equal(output.truncation.returnedItems, 2);
    assert.equal(output.truncation.truncated, true);
    assert.equal(contacted, false);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});
