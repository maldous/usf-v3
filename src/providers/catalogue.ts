import { canonicalDigest, sha256 } from "../core/canonical.ts";

const HARD_MAX_RAW_BYTES = 64 * 1024 * 1024;
const HARD_MAX_PROVIDERS = 4_096;
const HARD_MAX_MODELS = 250_000;
const HARD_MAX_COLLECTION = 512;
const HARD_MAX_STRING_LENGTH = 4_096;

const DEFAULT_BOUNDS = Object.freeze({
  maxRawBytes: 16 * 1024 * 1024,
  maxProviders: 2_048,
  maxModels: 100_000,
  maxCollectionItems: 128,
  maxStringLength: 2_048,
});

const capabilityFields = Object.freeze([
  ["attachment", "attachment"],
  ["reasoning", "reasoning"],
  ["structured_output", "structured-output"],
  ["temperature", "temperature"],
  ["tool_call", "tool-call"],
] as const);

export type CatalogueCapability = (typeof capabilityFields)[number][1];
export type CatalogueReason =
  | "CATALOGUE_BOUND_INVALID"
  | "CATALOGUE_INPUT_TOO_LARGE"
  | "CATALOGUE_INVALID_UTF8"
  | "CATALOGUE_INVALID_JSON"
  | "CATALOGUE_INVALID_SHAPE"
  | "CATALOGUE_PROVIDER_LIMIT"
  | "CATALOGUE_MODEL_LIMIT"
  | "CATALOGUE_INVALID_FILTER";

export class ModelCatalogueError extends Error {
  readonly reasonCode: CatalogueReason;
  readonly path: string;

  constructor(reasonCode: CatalogueReason, path: string) {
    super(`${reasonCode} at ${path}`);
    this.name = "ModelCatalogueError";
    this.reasonCode = reasonCode;
    this.path = path;
  }
}

export interface CatalogueBounds {
  readonly maxRawBytes?: number;
  readonly maxProviders?: number;
  readonly maxModels?: number;
  readonly maxCollectionItems?: number;
  readonly maxStringLength?: number;
}

export interface ModelsDevCatalogueOptions extends CatalogueBounds {
  /** Exact package name to installed version. Values are operational metadata, never semantic authority. */
  readonly installedAdapters?: Readonly<Record<string, string>>;
}

export interface CatalogueAdapter {
  readonly package: string | null;
  readonly installedVersion: string | null;
}

export interface CatalogueCapabilities {
  readonly attachment: boolean | null;
  readonly reasoning: boolean | null;
  readonly structuredOutput: boolean | null;
  readonly temperature: boolean | null;
  readonly toolCall: boolean | null;
}

export interface CatalogueModalities {
  readonly input: readonly string[] | null;
  readonly output: readonly string[] | null;
}

export interface CatalogueCost {
  readonly currency: "USD";
  readonly unit: "per-million-tokens";
  readonly input: number | null;
  readonly output: number | null;
  readonly reasoning: number | null;
  readonly cacheRead: number | null;
  readonly cacheWrite: number | null;
  readonly inputAudio: number | null;
  readonly outputAudio: number | null;
}

export interface CatalogueLimits {
  readonly context: number | null;
  readonly input: number | null;
  readonly output: number | null;
}

export interface CatalogueModel {
  readonly route: { readonly provider: string; readonly model: string };
  readonly underlying: { readonly family: string | null; readonly model: string };
  readonly name: string;
  readonly nameSource: "catalogue" | "route-id-fallback";
  readonly capabilities: CatalogueCapabilities;
  readonly capabilityNames: readonly CatalogueCapability[];
  readonly modalities: CatalogueModalities;
  readonly openWeights: boolean | null;
  readonly cost: CatalogueCost;
  readonly limits: CatalogueLimits;
}

export interface CatalogueProvider {
  readonly providerRoute: string;
  readonly name: string;
  readonly adapter: CatalogueAdapter;
  readonly credentialNames: readonly string[];
  readonly models: readonly CatalogueModel[];
}

export interface CatalogueDenominators {
  readonly providerRoutes: number;
  readonly modelRoutes: number;
  readonly underlyingModels: number;
  readonly underlyingFamilies: number;
  readonly unknownUnderlyingFamilies: number;
  readonly adapterPackages: number;
  readonly installedAdapterPackages: number;
  readonly credentialNames: number;
  readonly cataloguePriceKnownModels: number;
  readonly cataloguePriceUnknownModels: number;
  readonly catalogueZeroPriceModels: number;
}

export interface ModelCatalogueSnapshot {
  readonly schema: "urn:usf:model-catalogue:1";
  readonly source: "models.dev/api.json";
  readonly rawDigest: `sha256:${string}`;
  readonly normalizedDigest: `sha256:${string}`;
  readonly denominators: CatalogueDenominators;
  readonly providers: readonly CatalogueProvider[];
  readonly nonclaims: readonly string[];
}

export interface CatalogueFilter {
  readonly providerRoutes?: readonly string[];
  readonly routeModels?: readonly string[];
  readonly underlyingFamilies?: readonly string[];
  readonly underlyingModels?: readonly string[];
  readonly capabilities?: readonly CatalogueCapability[];
  readonly credentialNames?: readonly string[];
  readonly installedAdapter?: boolean;
  readonly cataloguePrice?: "known" | "unknown" | "zero-price";
}

export interface CatalogueModelView {
  readonly providerRoute: string;
  readonly providerName: string;
  readonly adapter: CatalogueAdapter;
  readonly credentialNames: readonly string[];
  readonly model: CatalogueModel;
}

interface ResolvedBounds {
  readonly maxRawBytes: number;
  readonly maxProviders: number;
  readonly maxModels: number;
  readonly maxCollectionItems: number;
  readonly maxStringLength: number;
}

function fail(reasonCode: CatalogueReason, path: string): never {
  throw new ModelCatalogueError(reasonCode, path);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function boundedInteger(value: number | undefined, fallback: number, hardMaximum: number, path: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0 || resolved > hardMaximum) {
    fail("CATALOGUE_BOUND_INVALID", path);
  }
  return resolved;
}

function resolveBounds(options: CatalogueBounds): ResolvedBounds {
  return Object.freeze({
    maxRawBytes: boundedInteger(options.maxRawBytes, DEFAULT_BOUNDS.maxRawBytes, HARD_MAX_RAW_BYTES, "options.maxRawBytes"),
    maxProviders: boundedInteger(options.maxProviders, DEFAULT_BOUNDS.maxProviders, HARD_MAX_PROVIDERS, "options.maxProviders"),
    maxModels: boundedInteger(options.maxModels, DEFAULT_BOUNDS.maxModels, HARD_MAX_MODELS, "options.maxModels"),
    maxCollectionItems: boundedInteger(options.maxCollectionItems, DEFAULT_BOUNDS.maxCollectionItems, HARD_MAX_COLLECTION, "options.maxCollectionItems"),
    maxStringLength: boundedInteger(options.maxStringLength, DEFAULT_BOUNDS.maxStringLength, HARD_MAX_STRING_LENGTH, "options.maxStringLength"),
  });
}

function text(value: unknown, path: string, bounds: ResolvedBounds): string {
  if (typeof value !== "string" || value.length === 0 || value.length > bounds.maxStringLength || /[\u0000-\u001f\u007f]/u.test(value)) {
    fail("CATALOGUE_INVALID_SHAPE", path);
  }
  return value;
}

function token(value: unknown, path: string, bounds: ResolvedBounds): string {
  const result = text(value, path, bounds);
  if (/\s|\\/u.test(result)) fail("CATALOGUE_INVALID_SHAPE", path);
  return result;
}

function optionalText(value: unknown, path: string, bounds: ResolvedBounds): string | null {
  return value === undefined ? null : text(value, path, bounds);
}

function optionalToken(value: unknown, path: string, bounds: ResolvedBounds): string | null {
  return value === undefined ? null : token(value, path, bounds);
}

function optionalBoolean(value: unknown, path: string): boolean | null {
  if (value === undefined) return null;
  if (typeof value !== "boolean") fail("CATALOGUE_INVALID_SHAPE", path);
  return value;
}

function optionalNonNegativeNumber(value: unknown, path: string): number | null {
  if (value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) fail("CATALOGUE_INVALID_SHAPE", path);
  return value;
}

function optionalNatural(value: unknown, path: string): number | null {
  if (value === undefined) return null;
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail("CATALOGUE_INVALID_SHAPE", path);
  return value as number;
}

function sortedUniqueStrings(value: unknown, path: string, bounds: ResolvedBounds, credential = false): readonly string[] {
  if (!Array.isArray(value) || value.length > bounds.maxCollectionItems) fail("CATALOGUE_INVALID_SHAPE", path);
  const values = value.map((entry, index) => token(entry, `${path}[${index}]`, bounds));
  // Public catalogue inventory is not an environment loader. Preserve
  // upstream names such as `302AI_API_KEY`; configured routes retain their
  // stricter executable allowlist.
  if (credential && values.some((entry) => !/^[A-Z0-9_]{1,128}$/u.test(entry))) fail("CATALOGUE_INVALID_SHAPE", path);
  return Object.freeze([...new Set(values)].sort(compareText));
}

function normalizeInstalledAdapters(value: Readonly<Record<string, string>> | undefined, bounds: ResolvedBounds): ReadonlyMap<string, string> {
  if (value === undefined) return new Map();
  if (!isRecord(value)) fail("CATALOGUE_INVALID_SHAPE", "options.installedAdapters");
  const entries = Object.entries(value);
  if (entries.length > bounds.maxProviders) fail("CATALOGUE_INVALID_SHAPE", "options.installedAdapters");
  return new Map(entries.map(([packageName, version]) => [
    token(packageName, `options.installedAdapters.${packageName}`, bounds),
    token(version, `options.installedAdapters.${packageName}`, bounds),
  ]));
}

function normalizeModalities(value: unknown, path: string, bounds: ResolvedBounds): CatalogueModalities {
  if (value === undefined) return Object.freeze({ input: null, output: null });
  if (!isRecord(value)) fail("CATALOGUE_INVALID_SHAPE", path);
  return Object.freeze({
    input: value.input === undefined ? null : sortedUniqueStrings(value.input, `${path}.input`, bounds),
    output: value.output === undefined ? null : sortedUniqueStrings(value.output, `${path}.output`, bounds),
  });
}

function normalizeCost(value: unknown, path: string): CatalogueCost {
  if (value !== undefined && !isRecord(value)) fail("CATALOGUE_INVALID_SHAPE", path);
  const cost = value as Record<string, unknown> | undefined;
  return Object.freeze({
    currency: "USD" as const,
    unit: "per-million-tokens" as const,
    input: optionalNonNegativeNumber(cost?.input, `${path}.input`),
    output: optionalNonNegativeNumber(cost?.output, `${path}.output`),
    reasoning: optionalNonNegativeNumber(cost?.reasoning, `${path}.reasoning`),
    cacheRead: optionalNonNegativeNumber(cost?.cache_read, `${path}.cache_read`),
    cacheWrite: optionalNonNegativeNumber(cost?.cache_write, `${path}.cache_write`),
    inputAudio: optionalNonNegativeNumber(cost?.input_audio, `${path}.input_audio`),
    outputAudio: optionalNonNegativeNumber(cost?.output_audio, `${path}.output_audio`),
  });
}

function normalizeLimits(value: unknown, path: string): CatalogueLimits {
  if (value !== undefined && !isRecord(value)) fail("CATALOGUE_INVALID_SHAPE", path);
  const limit = value as Record<string, unknown> | undefined;
  return Object.freeze({
    context: optionalNatural(limit?.context, `${path}.context`),
    input: optionalNatural(limit?.input, `${path}.input`),
    output: optionalNatural(limit?.output, `${path}.output`),
  });
}

function normalizeModel(providerRoute: string, routeModel: string, value: unknown, path: string, bounds: ResolvedBounds): CatalogueModel {
  if (!isRecord(value)) fail("CATALOGUE_INVALID_SHAPE", path);
  if (value.id !== undefined && token(value.id, `${path}.id`, bounds) !== routeModel) fail("CATALOGUE_INVALID_SHAPE", `${path}.id`);
  const family = optionalToken(value.family, `${path}.family`, bounds);
  const baseModel = optionalToken(value.base_model, `${path}.base_model`, bounds);
  const capabilities = Object.freeze({
    attachment: optionalBoolean(value.attachment, `${path}.attachment`),
    reasoning: optionalBoolean(value.reasoning, `${path}.reasoning`),
    structuredOutput: optionalBoolean(value.structured_output, `${path}.structured_output`),
    temperature: optionalBoolean(value.temperature, `${path}.temperature`),
    toolCall: optionalBoolean(value.tool_call, `${path}.tool_call`),
  });
  const statusByName: Readonly<Record<CatalogueCapability, boolean | null>> = Object.freeze({
    attachment: capabilities.attachment,
    reasoning: capabilities.reasoning,
    "structured-output": capabilities.structuredOutput,
    temperature: capabilities.temperature,
    "tool-call": capabilities.toolCall,
  });
  const capabilityNames = capabilityFields
    .map(([, name]) => name)
    .filter((name) => statusByName[name] === true)
    .sort(compareText);

  const explicitName = typeof value.name === "string" && value.name.length > 0
    && value.name.length <= bounds.maxStringLength && !/[\u0000-\u001f\u007f]/u.test(value.name)
    ? value.name
    : null;
  return freeze({
    route: { provider: providerRoute, model: routeModel },
    underlying: { family, model: baseModel ?? routeModel },
    name: explicitName ?? routeModel,
    nameSource: explicitName === null ? "route-id-fallback" as const : "catalogue" as const,
    capabilities,
    capabilityNames,
    modalities: normalizeModalities(value.modalities, `${path}.modalities`, bounds),
    openWeights: optionalBoolean(value.open_weights, `${path}.open_weights`),
    cost: normalizeCost(value.cost, `${path}.cost`),
    limits: normalizeLimits(value.limit, `${path}.limit`),
  });
}

function normalizeProvider(
  providerRoute: string,
  value: unknown,
  path: string,
  bounds: ResolvedBounds,
  installedAdapters: ReadonlyMap<string, string>,
  modelCounter: { value: number },
): CatalogueProvider {
  if (!isRecord(value)) fail("CATALOGUE_INVALID_SHAPE", path);
  if (value.id !== undefined && token(value.id, `${path}.id`, bounds) !== providerRoute) fail("CATALOGUE_INVALID_SHAPE", `${path}.id`);
  if (!isRecord(value.models)) fail("CATALOGUE_INVALID_SHAPE", `${path}.models`);
  const adapterPackage = optionalToken(value.npm, `${path}.npm`, bounds);
  const modelEntries = Object.entries(value.models);
  modelCounter.value += modelEntries.length;
  if (modelCounter.value > bounds.maxModels) fail("CATALOGUE_MODEL_LIMIT", `${path}.models`);
  const models = modelEntries.map(([routeModel, model]) => {
    const safeRouteModel = token(routeModel, `${path}.models key`, bounds);
    return normalizeModel(providerRoute, safeRouteModel, model, `${path}.models.${safeRouteModel}`, bounds);
  }).sort((left, right) => compareText(left.route.model, right.route.model));

  return freeze({
    providerRoute,
    name: text(value.name, `${path}.name`, bounds),
    adapter: {
      package: adapterPackage,
      installedVersion: adapterPackage === null ? null : installedAdapters.get(adapterPackage) ?? null,
    },
    credentialNames: value.env === undefined ? Object.freeze([]) : sortedUniqueStrings(value.env, `${path}.env`, bounds, true),
    models,
  });
}

function denominators(providers: readonly CatalogueProvider[]): CatalogueDenominators {
  const models = providers.flatMap((provider) => provider.models);
  const adapterPackages = new Set(providers.flatMap((provider) => provider.adapter.package === null ? [] : [provider.adapter.package]));
  const installedAdapterPackages = new Set(providers.flatMap((provider) => provider.adapter.package !== null && provider.adapter.installedVersion !== null ? [provider.adapter.package] : []));
  const credentialNames = new Set(providers.flatMap((provider) => provider.credentialNames));
  const underlyingModels = new Set(models.map((model) => `${model.underlying.family ?? "<unknown>"}\u0000${model.underlying.model}`));
  const underlyingFamilies = new Set(models.flatMap((model) => model.underlying.family === null ? [] : [model.underlying.family]));
  const knownPrices = models.filter((model) => model.cost.input !== null && model.cost.output !== null);

  // "Zero price" is deliberately stricter than zero base input/output.  A
  // separately billable capability must also be known-zero when the catalogue
  // says that capability is present.  Cache dimensions are treated as
  // applicable because providers may apply caching without a distinct model
  // route.  Audio is applicable only when the normalized modalities include
  // it.  Unknown applicable pricing is not zero.
  const hasExactZeroApplicablePrice = (model: CatalogueModel): boolean => {
    const applicable = [model.cost.input, model.cost.output, model.cost.cacheRead, model.cost.cacheWrite];
    if (model.capabilities.reasoning !== false) applicable.push(model.cost.reasoning);
    if (model.modalities.input?.includes("audio")) applicable.push(model.cost.inputAudio);
    if (model.modalities.output?.includes("audio")) applicable.push(model.cost.outputAudio);
    return applicable.every((price) => price !== null && price === 0);
  };

  return Object.freeze({
    providerRoutes: providers.length,
    modelRoutes: models.length,
    underlyingModels: underlyingModels.size,
    underlyingFamilies: underlyingFamilies.size,
    unknownUnderlyingFamilies: models.filter((model) => model.underlying.family === null).length,
    adapterPackages: adapterPackages.size,
    installedAdapterPackages: installedAdapterPackages.size,
    credentialNames: credentialNames.size,
    cataloguePriceKnownModels: knownPrices.length,
    cataloguePriceUnknownModels: models.length - knownPrices.length,
    catalogueZeroPriceModels: models.filter(hasExactZeroApplicablePrice).length,
  });
}

function exactBytes(raw: string | Uint8Array): Uint8Array {
  if (typeof raw === "string") return new TextEncoder().encode(raw);
  if (raw instanceof Uint8Array) return raw;
  return fail("CATALOGUE_INVALID_SHAPE", "raw");
}

export function normalizeModelsDevCatalogue(raw: string | Uint8Array, options: ModelsDevCatalogueOptions = {}): ModelCatalogueSnapshot {
  const bounds = resolveBounds(options);
  const bytes = exactBytes(raw);
  if (bytes.byteLength > bounds.maxRawBytes) fail("CATALOGUE_INPUT_TOO_LARGE", "raw");
  let sourceText: string;
  try {
    sourceText = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return fail("CATALOGUE_INVALID_UTF8", "raw");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(sourceText) as unknown;
  } catch {
    return fail("CATALOGUE_INVALID_JSON", "raw");
  }
  if (!isRecord(parsed)) fail("CATALOGUE_INVALID_SHAPE", "$");
  const providerEntries = Object.entries(parsed);
  if (providerEntries.length > bounds.maxProviders) fail("CATALOGUE_PROVIDER_LIMIT", "$");
  const installedAdapters = normalizeInstalledAdapters(options.installedAdapters, bounds);
  const modelCounter = { value: 0 };
  const providers = providerEntries.map(([providerRoute, provider]) => {
    const safeProviderRoute = token(providerRoute, "$ provider key", bounds);
    return normalizeProvider(safeProviderRoute, provider, `$.${safeProviderRoute}`, bounds, installedAdapters, modelCounter);
  }).sort((left, right) => compareText(left.providerRoute, right.providerRoute));
  const denominatorView = denominators(providers);
  const nonclaims = Object.freeze([
    "catalogue-membership-is-not-current-route-availability",
    "catalogue-price-is-not-current-entitlement-or-quota",
    "adapter-installation-is-not-working-authentication",
  ]);
  const normalizedBasis = freeze({
    schema: "urn:usf:model-catalogue:1" as const,
    source: "models.dev/api.json" as const,
    denominators: denominatorView,
    providers,
    nonclaims,
  });
  return freeze({
    schema: normalizedBasis.schema,
    source: normalizedBasis.source,
    rawDigest: sha256(bytes),
    normalizedDigest: canonicalDigest(normalizedBasis),
    denominators: denominatorView,
    providers,
    nonclaims,
  });
}

function filterSet(values: readonly string[] | undefined, path: string): ReadonlySet<string> | null {
  if (values === undefined) return null;
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || value.length === 0)) {
    fail("CATALOGUE_INVALID_FILTER", path);
  }
  return new Set(values);
}

export function filterCatalogueModels(snapshot: ModelCatalogueSnapshot, filter: CatalogueFilter = {}): readonly CatalogueModelView[] {
  const providerRoutes = filterSet(filter.providerRoutes, "filter.providerRoutes");
  const routeModels = filterSet(filter.routeModels, "filter.routeModels");
  const underlyingFamilies = filterSet(filter.underlyingFamilies, "filter.underlyingFamilies");
  const underlyingModels = filterSet(filter.underlyingModels, "filter.underlyingModels");
  const credentialNames = filterSet(filter.credentialNames, "filter.credentialNames");
  const capabilities = filterSet(filter.capabilities, "filter.capabilities");
  if (capabilities !== null && [...capabilities].some((capability) => !capabilityFields.some(([, name]) => name === capability))) {
    fail("CATALOGUE_INVALID_FILTER", "filter.capabilities");
  }
  if (filter.cataloguePrice !== undefined && !["known", "unknown", "zero-price"].includes(filter.cataloguePrice)) {
    fail("CATALOGUE_INVALID_FILTER", "filter.cataloguePrice");
  }
  if (filter.installedAdapter !== undefined && typeof filter.installedAdapter !== "boolean") {
    fail("CATALOGUE_INVALID_FILTER", "filter.installedAdapter");
  }

  const results: CatalogueModelView[] = [];
  for (const provider of snapshot.providers) {
    if (providerRoutes !== null && !providerRoutes.has(provider.providerRoute)) continue;
    if (filter.installedAdapter !== undefined && (provider.adapter.installedVersion !== null) !== filter.installedAdapter) continue;
    if (credentialNames !== null && ![...credentialNames].every((name) => provider.credentialNames.includes(name))) continue;
    for (const model of provider.models) {
      const knownPrice = model.cost.input !== null && model.cost.output !== null;
      if (routeModels !== null && !routeModels.has(model.route.model)) continue;
      if (underlyingFamilies !== null && (model.underlying.family === null || !underlyingFamilies.has(model.underlying.family))) continue;
      if (underlyingModels !== null && !underlyingModels.has(model.underlying.model)) continue;
      if (capabilities !== null && ![...capabilities].every((capability) => model.capabilityNames.includes(capability as CatalogueCapability))) continue;
      if (filter.cataloguePrice === "known" && !knownPrice) continue;
      if (filter.cataloguePrice === "unknown" && knownPrice) continue;
      if (filter.cataloguePrice === "zero-price") {
        const applicable = [model.cost.input, model.cost.output, model.cost.cacheRead, model.cost.cacheWrite];
        if (model.capabilities.reasoning !== false) applicable.push(model.cost.reasoning);
        if (model.modalities.input?.includes("audio")) applicable.push(model.cost.inputAudio);
        if (model.modalities.output?.includes("audio")) applicable.push(model.cost.outputAudio);
        if (!applicable.every((price) => price !== null && price === 0)) continue;
      }
      results.push(freeze({
        providerRoute: provider.providerRoute,
        providerName: provider.name,
        adapter: provider.adapter,
        credentialNames: provider.credentialNames,
        model,
      }));
    }
  }
  return Object.freeze(results.sort((left, right) =>
    compareText(left.providerRoute, right.providerRoute) || compareText(left.model.route.model, right.model.route.model),
  ));
}
