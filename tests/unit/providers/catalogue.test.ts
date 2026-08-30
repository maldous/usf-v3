import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  ModelCatalogueError,
  filterCatalogueModels,
  normalizeModelsDevCatalogue,
  type ModelsDevCatalogueOptions,
} from "../../../src/providers/catalogue.ts";
import { createJsonSchemaValidator } from "../../../src/schema/index.ts";

const fixturePath = fileURLToPath(new URL("../../fixtures/providers/models-dev.json", import.meta.url));
const schemaPath = fileURLToPath(new URL("../../../schemas/model-catalogue.schema.json", import.meta.url));
const raw = readFileSync(fixturePath);
const installedAdapters = { "@ai-sdk/alpha": "1.2.3" };

test("models.dev provider objects normalize with separate exact and semantic digests", () => {
  const snapshot = normalizeModelsDevCatalogue(raw, { installedAdapters });
  assert.equal(createJsonSchemaValidator(JSON.parse(readFileSync(schemaPath, "utf8"))).validate(snapshot).valid, true);
  assert.deepEqual(snapshot.providers.map((provider) => provider.providerRoute), ["alpha-direct", "zeta-router"]);
  assert.deepEqual(snapshot.providers[0]?.models.map((model) => model.route.model), ["alpha-paid", "alpha-zero"]);
  assert.deepEqual(snapshot.providers[0]?.adapter, { package: "@ai-sdk/alpha", installedVersion: "1.2.3" });
  assert.deepEqual(snapshot.providers[0]?.credentialNames, ["ALPHA_REGION", "ALPHA_TOKEN"]);
  assert.deepEqual(snapshot.providers[1]?.credentialNames, ["302AI_API_KEY", "ZETA_TOKEN"]);
  assert.deepEqual(snapshot.denominators, {
    providerRoutes: 2,
    modelRoutes: 3,
    underlyingModels: 3,
    underlyingFamilies: 2,
    unknownUnderlyingFamilies: 0,
    adapterPackages: 2,
    installedAdapterPackages: 1,
    credentialNames: 4,
    cataloguePriceKnownModels: 2,
    cataloguePriceUnknownModels: 1,
    catalogueZeroPriceModels: 1,
  });

  const parsed = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
  const reordered = JSON.stringify({ "alpha-direct": parsed["alpha-direct"], "zeta-router": parsed["zeta-router"] });
  const reorderedSnapshot = normalizeModelsDevCatalogue(reordered, { installedAdapters });
  assert.notEqual(snapshot.rawDigest, reorderedSnapshot.rawDigest);
  assert.equal(snapshot.normalizedDigest, reorderedSnapshot.normalizedDigest);
  assert.notEqual(snapshot.normalizedDigest, normalizeModelsDevCatalogue(reordered, { installedAdapters: { "@ai-sdk/alpha": "1.2.4" } }).normalizedDigest);
});

test("route identity, underlying identity and unknown price remain distinct", () => {
  const snapshot = normalizeModelsDevCatalogue(raw, { installedAdapters });
  const unknown = snapshot.providers[1]?.models[0];
  assert.deepEqual(unknown?.route, { provider: "zeta-router", model: "zeta/unknown-model" });
  assert.deepEqual(unknown?.underlying, { family: "zeta-family", model: "zeta/unknown-model" });
  assert.equal(unknown?.cost.input, null);
  assert.equal(unknown?.cost.output, null);
  assert.notEqual(unknown?.cost.input, 0);
  assert.throws(() => { (snapshot.providers as unknown as CatalogueMutation[])[0]!.providerRoute = "changed"; }, TypeError);
});

interface CatalogueMutation { providerRoute: string }

test("deterministic filters preserve exact price and installed-adapter semantics", () => {
  const snapshot = normalizeModelsDevCatalogue(raw, { installedAdapters });
  assert.deepEqual(filterCatalogueModels(snapshot, { capabilities: ["reasoning", "tool-call"], installedAdapter: true, cataloguePrice: "zero-price" }).map((entry) => `${entry.providerRoute}/${entry.model.route.model}`), ["alpha-direct/alpha-zero"]);
  assert.deepEqual(filterCatalogueModels(snapshot, { cataloguePrice: "unknown" }).map((entry) => entry.model.route.model), ["zeta/unknown-model"]);
  assert.deepEqual(filterCatalogueModels(snapshot, { underlyingFamilies: ["alpha-family"], credentialNames: ["ALPHA_TOKEN"] }).map((entry) => entry.model.route.model), ["alpha-paid", "alpha-zero"]);
  assert.throws(() => filterCatalogueModels(snapshot, { capabilities: ["invented" as "reasoning"] }), (error: unknown) => error instanceof ModelCatalogueError && error.reasonCode === "CATALOGUE_INVALID_FILTER");

  const parsed = JSON.parse(raw.toString("utf8")) as Record<string, any>;
  parsed["alpha-direct"].models["alpha-zero"].cost.reasoning = 5;
  const reasoningCharged = normalizeModelsDevCatalogue(JSON.stringify(parsed), { installedAdapters });
  assert.equal(reasoningCharged.denominators.catalogueZeroPriceModels, 0);
  assert.deepEqual(filterCatalogueModels(reasoningCharged, { cataloguePrice: "zero-price" }), []);
});

test("malformed and unbounded catalogue inputs fail closed", () => {
  const cases: readonly [ModelsDevCatalogueOptions, string, string][] = [
    [{}, "{", "CATALOGUE_INVALID_JSON"],
    [{ maxRawBytes: 3 }, raw.toString("utf8"), "CATALOGUE_INPUT_TOO_LARGE"],
    [{ maxProviders: 1 }, raw.toString("utf8"), "CATALOGUE_PROVIDER_LIMIT"],
  ];
  for (const [options, input, reasonCode] of cases) {
    assert.throws(() => normalizeModelsDevCatalogue(input, options), (error: unknown) => error instanceof ModelCatalogueError && error.reasonCode === reasonCode);
  }

  const malformed = JSON.stringify({ bad: { id: "different", name: "Bad", env: [], models: {} } });
  assert.throws(() => normalizeModelsDevCatalogue(malformed), (error: unknown) => error instanceof ModelCatalogueError && error.reasonCode === "CATALOGUE_INVALID_SHAPE");
  assert.throws(() => normalizeModelsDevCatalogue(new Uint8Array([0xff])), (error: unknown) => error instanceof ModelCatalogueError && error.reasonCode === "CATALOGUE_INVALID_UTF8");

  for (const name of [undefined, null, ""]) {
    const missingDisplayName = JSON.stringify({
      alpha: { name: "Alpha", env: [], models: { "model-id": { reasoning: false, ...(name === undefined ? {} : { name }) } } },
    });
    const fallback = normalizeModelsDevCatalogue(missingDisplayName).providers[0]!.models[0]!;
    assert.equal(fallback.name, "model-id");
    assert.equal(fallback.nameSource, "route-id-fallback");
  }
});
