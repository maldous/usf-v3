import { constants } from "node:fs";
import { access, lstat, open } from "node:fs/promises";
import { resolve } from "node:path";

import { canonicalDigest, sha256 } from "../core/canonical.ts";
import { exitCodes, UsfError } from "../core/errors.ts";
import { validateRepositoryManifest, validateVersionedProfile } from "../continuous/lifecycle.ts";
import { loadSemanticGraph } from "../graph/index.ts";
import { deriveWork } from "../graph/work.ts";
import {
  CredentialEnvError,
  parseProviderConfig,
  ProviderConfigError,
  type ProviderConfig,
  type ProviderRouteConfig,
} from "../providers/config.ts";
import {
  CredentialInspectionError,
  inspectCredentialPresence,
  type CredentialPresenceObservation,
} from "../providers/credentials.ts";
import type { CatalogueModelView, ModelCatalogueSnapshot } from "../providers/catalogue.ts";
import type { CommandHandler } from "./dispatcher.ts";
import { observeInstalledAdapter, readLocalCatalogue } from "./models.ts";
import { createProviderLeafCompletionAuthorizer, createProviderLeafDispatcher } from "./provider-leaf-dispatch.ts";

const providerConfigPath = "config/providers.json";
const legacyProviderConfigPath = "config/provider-legacy-observations.json";
const maximumProviderConfigBytes = 256 * 1024;
const maximumLegacyProviderConfigBytes = 256 * 1024;
const defaultMaxItems = 50;
const maximumMaxItems = 1_000;
const maximumExplicitPathLength = 4_096;
const boundedIdentityPattern = /^[A-Za-z0-9@._:/+-]{1,256}$/u;
const publicCredentialNamePattern = /^[A-Za-z0-9_]{1,128}$/u;

type ProvidersOperation = "census" | "status" | "aliases";

interface ParsedArguments {
  readonly operation: ProvidersOperation;
  readonly maxItems: number;
  readonly envFile: string | undefined;
  readonly route: string | undefined;
  readonly provider: string | undefined;
  readonly transport: string | undefined;
  readonly credentialName: string | undefined;
  readonly profile: string | undefined;
  readonly manifest: string | undefined;
}

type HistoricalDisposition = "admitted" | "unavailable" | "deferred" | "configured-default";

interface LegacySource {
  readonly id: string;
  readonly repository: string | null;
  readonly revision: string | null;
  readonly tree: string | null;
  readonly path: string;
  readonly contentDigest: string;
}

interface LegacyHostTransport {
  readonly id: string;
  readonly executableNames: readonly string[];
  readonly apiCredentialCandidate: string | null;
}

interface LegacyProviderObservation {
  readonly id: string;
  readonly provider: string;
  readonly model: string;
  readonly transport: string;
  readonly credentialName: string | null;
  readonly historicalDisposition: HistoricalDisposition;
  readonly providerAliases: readonly string[];
  readonly modelAliases: readonly string[];
  readonly source: string;
}

interface LegacyProviderConfig {
  readonly $schema: "urn:usf:provider-legacy-observations:1";
  readonly version: 1;
  readonly sources: readonly LegacySource[];
  readonly credentialNames: readonly string[];
  readonly credentialNameProvenance: {
    readonly source: "reviewed-v2-untracked-environment-names-only";
    readonly rawSourceDisposition: "secret-bearing-untracked-file-not-copied-or-digested";
    readonly projectionDigest: string;
  };
  readonly credentialAliasCandidates: readonly { readonly source: string; readonly targets: readonly string[] }[];
  readonly nonAiServiceCredentialNames: readonly string[];
  readonly hostTransports: readonly LegacyHostTransport[];
  readonly providerModelObservations: readonly LegacyProviderObservation[];
  readonly nonclaims: readonly string[];
}

interface LegacyProviderRead {
  readonly config: LegacyProviderConfig;
  readonly rawDigest: string;
  readonly normalizedDigest: string;
}

function providersError(code: string, exitCode: (typeof exitCodes)[keyof typeof exitCodes], message: string, details?: Record<string, unknown>): never {
  throw new UsfError(code, exitCode, message, details);
}

function parsePositiveInteger(value: string | undefined): number {
  if (value === undefined) return defaultMaxItems;
  if (!/^[1-9][0-9]{0,3}$/u.test(value)) providersError("PROVIDERS_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, "--max-items must be a bounded positive integer.");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximumMaxItems) providersError("PROVIDERS_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, "--max-items is outside its supported bound.");
  return parsed;
}

function boundedIdentity(value: string | undefined, pattern = boundedIdentityPattern): string | undefined {
  if (value === undefined) return undefined;
  if (!pattern.test(value)) providersError("PROVIDERS_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, "A provider filter is not a bounded identity.");
  return value;
}

function parseArguments(args: readonly string[]): ParsedArguments {
  const operation = args[0];
  if (operation !== "census" && operation !== "status" && operation !== "aliases") {
    providersError("PROVIDERS_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, "Providers requires exactly one of census, status or aliases.");
  }
  const remaining = args.slice(1);
  if (remaining.length % 2 !== 0) providersError("PROVIDERS_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, "Provider options require explicit values.");
  const values = new Map<string, string>();
  for (let index = 0; index < remaining.length; index += 2) {
    const option = remaining[index]!;
    const value = remaining[index + 1]!;
    if (!option.startsWith("--") || value.length === 0 || value.startsWith("--") || values.has(option)) {
      providersError("PROVIDERS_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, "Provider options must be unique flag/value pairs.");
    }
    values.set(option, value);
  }
  const allowed = new Set(["--max-items", "--route", "--provider", "--transport", "--credential-name", "--profile", "--manifest"]);
  if (operation !== "aliases") allowed.add("--env-file");
  for (const option of values.keys()) {
    if (!allowed.has(option)) providersError("PROVIDERS_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, "Unknown provider option.");
  }
  const envFile = values.get("--env-file");
  if (envFile !== undefined && (envFile.length > maximumExplicitPathLength || envFile.includes("\u0000"))) {
    providersError("PROVIDERS_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, "--env-file must be one bounded explicit path.");
  }
  const selectedProfile = values.get("--profile");
  const selectedManifest = values.get("--manifest");
  if ((selectedProfile === undefined) !== (selectedManifest === undefined)) {
    providersError("PROVIDERS_SCOPE_INCOMPLETE", exitCodes.INVALID_INPUT, "Semantic provider scope requires both --profile and --manifest; no product overlay is selected implicitly.");
  }
  let profile: string | undefined;
  let manifest: string | undefined;
  if (selectedProfile !== undefined && selectedManifest !== undefined) {
    try {
      profile = validateVersionedProfile(selectedProfile);
      manifest = validateRepositoryManifest(selectedManifest);
    } catch {
      providersError("PROVIDERS_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, "The selected provider profile or manifest is invalid.");
    }
  }
  return Object.freeze({
    operation,
    maxItems: parsePositiveInteger(values.get("--max-items")),
    envFile,
    route: boundedIdentity(values.get("--route")),
    provider: boundedIdentity(values.get("--provider")),
    transport: boundedIdentity(values.get("--transport")),
    credentialName: boundedIdentity(values.get("--credential-name"), publicCredentialNamePattern),
    profile,
    manifest,
  });
}

function semanticScope(repositoryRoot: string, parsed: ParsedArguments): Readonly<Record<string, unknown>> {
  if (parsed.profile === undefined || parsed.manifest === undefined) {
    return Object.freeze({
      status: "not-selected",
      reasonCode: "PROVIDERS_PROFILE_NOT_SELECTED",
      selectionRequired: Object.freeze(["--profile", "--manifest"]),
    });
  }
  let result;
  try {
    result = deriveWork(loadSemanticGraph(repositoryRoot, parsed.manifest), {
      profile: parsed.profile,
      selector: "urn:usf:work:provider-census",
      maxItems: 1,
    });
  } catch (error) {
    const reasonCode = error instanceof UsfError
      ? error.code
      : error instanceof Error
        ? /^([A-Z][A-Z0-9_]{1,95})(?::|$)/u.exec(error.message)?.[1] ?? "GRAPH_LOAD_FAILED"
        : "GRAPH_LOAD_FAILED";
    return providersError("PROVIDERS_SCOPE_REFUSED", exitCodes.CURRENTNESS_FAILURE, "The selected provider semantic scope could not be derived.", { reasonCode });
  }
  const item = result.items?.[0];
  if (
    result.status !== "ok"
    || result.semanticDigest === undefined
    || result.items?.length !== 1
    || item?.id !== "urn:usf:work:provider-census"
    || item.contract !== "urn:usf:contract:provider-census:1"
    || item.decisionBoundary.kind !== "realisation-profile"
    || item.decisionBoundary.root !== parsed.profile
    || item.decisionBoundary.profileVersion === undefined
    || item.decisionBoundary.product === undefined
    || item.decisionBoundary.foundation === undefined
  ) {
    return providersError("PROVIDERS_SCOPE_REFUSED", exitCodes.CURRENTNESS_FAILURE, "The selected profile does not resolve the exact provider-census authority.", { reasonCode: result.reasonCode ?? "PROVIDER_CENSUS_WORK_NOT_SELECTED" });
  }
  return Object.freeze({
    status: "selected",
    profile: parsed.profile,
    profileVersion: item.decisionBoundary.profileVersion,
    product: item.decisionBoundary.product,
    foundation: item.decisionBoundary.foundation,
    manifest: parsed.manifest,
    semanticDigest: result.semanticDigest,
    work: item.id,
    contract: item.contract,
    scopedDependencyDigest: item.scopedDependencyDigest,
  });
}

function sameFile(left: Awaited<ReturnType<typeof lstat>>, right: Awaited<ReturnType<Awaited<ReturnType<typeof open>>["stat"]>>): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

async function readProviderConfig(repositoryRoot: string): Promise<ProviderConfig> {
  const path = resolve(repositoryRoot, providerConfigPath);
  let before;
  try { before = await lstat(path); }
  catch { return providersError("PROVIDERS_CONFIG_REFUSED", exitCodes.CURRENTNESS_FAILURE, "The tracked provider configuration is unavailable."); }
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > maximumProviderConfigBytes) {
    return providersError("PROVIDERS_CONFIG_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The provider configuration is unsafe.");
  }
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = await handle.stat();
    if (!sameFile(before, opened)) return providersError("PROVIDERS_CONFIG_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The provider configuration changed while opening.");
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (!sameFile(before, after) || bytes.byteLength !== before.size) return providersError("PROVIDERS_CONFIG_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The provider configuration changed while reading.");
    let value: unknown;
    try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
    catch { return providersError("PROVIDERS_CONFIG_INVALID", exitCodes.CURRENTNESS_FAILURE, "The provider configuration is not valid UTF-8 JSON."); }
    try { return parseProviderConfig(value); }
    catch (error) {
      if (error instanceof ProviderConfigError) return providersError("PROVIDERS_CONFIG_INVALID", exitCodes.CURRENTNESS_FAILURE, "The provider configuration does not satisfy its closed schema.", { configReasonCode: error.reasonCode });
      throw error;
    }
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function closedStringArray(value: unknown, pattern: RegExp, maximum = 256): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length > maximum || value.some((item) => typeof item !== "string" || !pattern.test(item))) return undefined;
  const sorted = [...value].sort((left, right) => left.localeCompare(right));
  return new Set(sorted).size === sorted.length ? Object.freeze(sorted) : undefined;
}

function parseLegacyProviderConfig(value: unknown): LegacyProviderConfig | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ["$schema", "version", "sources", "credentialNames", "credentialNameProvenance", "credentialAliasCandidates", "nonAiServiceCredentialNames", "hostTransports", "providerModelObservations", "nonclaims"])) return undefined;
  if (value.$schema !== "urn:usf:provider-legacy-observations:1" || value.version !== 1) return undefined;

  if (!Array.isArray(value.sources) || value.sources.length === 0 || value.sources.length > 16) return undefined;
  const sources: LegacySource[] = [];
  for (const candidate of value.sources) {
    if (!isRecord(candidate) || !hasExactKeys(candidate, ["id", "repository", "revision", "tree", "path", "contentDigest"])) return undefined;
    if (typeof candidate.id !== "string" || !boundedIdentityPattern.test(candidate.id)) return undefined;
    if (candidate.repository !== null && (typeof candidate.repository !== "string" || !/^https:\/\/[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]{1,2048}$/u.test(candidate.repository))) return undefined;
    if (candidate.revision !== null && (typeof candidate.revision !== "string" || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(candidate.revision))) return undefined;
    if (candidate.tree !== null && (typeof candidate.tree !== "string" || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(candidate.tree))) return undefined;
    if (typeof candidate.path !== "string" || candidate.path.length === 0 || candidate.path.length > 2048 || candidate.path.startsWith("/") || candidate.path.split("/").includes("..")) return undefined;
    if (typeof candidate.contentDigest !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(candidate.contentDigest)) return undefined;
    sources.push(Object.freeze({
      id: candidate.id,
      repository: candidate.repository,
      revision: candidate.revision,
      tree: candidate.tree,
      path: candidate.path,
      contentDigest: candidate.contentDigest,
    }));
  }
  if (new Set(sources.map((source) => source.id)).size !== sources.length) return undefined;
  const sourceIds = new Set(sources.map((source) => source.id));

  const credentialNames = closedStringArray(value.credentialNames, publicCredentialNamePattern);
  const nonAiServiceCredentialNames = closedStringArray(value.nonAiServiceCredentialNames, publicCredentialNamePattern);
  const nonclaims = closedStringArray(value.nonclaims, /^[a-z0-9-]{1,256}$/u, 32);
  if (credentialNames === undefined || nonAiServiceCredentialNames === undefined || nonclaims === undefined || nonAiServiceCredentialNames.some((name) => !credentialNames.includes(name))) return undefined;

  if (!Array.isArray(value.credentialAliasCandidates) || value.credentialAliasCandidates.length > 64) return undefined;
  const credentialAliasCandidates: Array<{ readonly source: string; readonly targets: readonly string[] }> = [];
  for (const candidate of value.credentialAliasCandidates) {
    if (!isRecord(candidate) || !hasExactKeys(candidate, ["source", "targets"]) || typeof candidate.source !== "string" || !credentialNames.includes(candidate.source)) return undefined;
    const targets = closedStringArray(candidate.targets, publicCredentialNamePattern, 16);
    if (targets === undefined || targets.length === 0) return undefined;
    credentialAliasCandidates.push(Object.freeze({ source: candidate.source, targets }));
  }
  if (new Set(credentialAliasCandidates.map((candidate) => candidate.source)).size !== credentialAliasCandidates.length) return undefined;
  credentialAliasCandidates.sort((left, right) => left.source.localeCompare(right.source));
  if (!isRecord(value.credentialNameProvenance)
    || !hasExactKeys(value.credentialNameProvenance, ["source", "rawSourceDisposition", "projectionDigest"])
    || value.credentialNameProvenance.source !== "reviewed-v2-untracked-environment-names-only"
    || value.credentialNameProvenance.rawSourceDisposition !== "secret-bearing-untracked-file-not-copied-or-digested"
    || typeof value.credentialNameProvenance.projectionDigest !== "string"
    || !/^sha256:[0-9a-f]{64}$/u.test(value.credentialNameProvenance.projectionDigest)
    || value.credentialNameProvenance.projectionDigest !== canonicalDigest({
      schema: "urn:usf:reviewed-legacy-credential-names:1",
      names: credentialNames,
      aliasCandidates: credentialAliasCandidates,
    }, { rejectAbsolutePaths: true })) return undefined;

  if (!Array.isArray(value.hostTransports) || value.hostTransports.length === 0 || value.hostTransports.length > 32) return undefined;
  const hostTransports: LegacyHostTransport[] = [];
  for (const candidate of value.hostTransports) {
    if (!isRecord(candidate) || !hasExactKeys(candidate, ["id", "executableNames", "apiCredentialCandidate"]) || typeof candidate.id !== "string" || !boundedIdentityPattern.test(candidate.id)) return undefined;
    const executableNames = closedStringArray(candidate.executableNames, /^[A-Za-z0-9._+-]{1,128}$/u, 16);
    if (executableNames === undefined || executableNames.length === 0) return undefined;
    if (candidate.apiCredentialCandidate !== null && (typeof candidate.apiCredentialCandidate !== "string" || !publicCredentialNamePattern.test(candidate.apiCredentialCandidate))) return undefined;
    hostTransports.push(Object.freeze({ id: candidate.id, executableNames, apiCredentialCandidate: candidate.apiCredentialCandidate }));
  }
  if (new Set(hostTransports.map((transport) => transport.id)).size !== hostTransports.length) return undefined;
  hostTransports.sort((left, right) => left.id.localeCompare(right.id));

  if (!Array.isArray(value.providerModelObservations) || value.providerModelObservations.length === 0 || value.providerModelObservations.length > 256) return undefined;
  const dispositions = new Set<HistoricalDisposition>(["admitted", "unavailable", "deferred", "configured-default"]);
  const providerModelObservations: LegacyProviderObservation[] = [];
  for (const candidate of value.providerModelObservations) {
    if (!isRecord(candidate) || !hasExactKeys(candidate, ["id", "provider", "model", "transport", "credentialName", "historicalDisposition", "providerAliases", "modelAliases", "source"])) return undefined;
    if (typeof candidate.id !== "string" || !boundedIdentityPattern.test(candidate.id)
      || typeof candidate.provider !== "string" || !boundedIdentityPattern.test(candidate.provider)
      || typeof candidate.model !== "string" || !boundedIdentityPattern.test(candidate.model)
      || typeof candidate.transport !== "string" || !boundedIdentityPattern.test(candidate.transport)
      || typeof candidate.historicalDisposition !== "string" || !dispositions.has(candidate.historicalDisposition as HistoricalDisposition)
      || typeof candidate.source !== "string" || !sourceIds.has(candidate.source)) return undefined;
    if (candidate.credentialName !== null && (typeof candidate.credentialName !== "string" || !publicCredentialNamePattern.test(candidate.credentialName))) return undefined;
    const providerAliases = closedStringArray(candidate.providerAliases, boundedIdentityPattern, 32);
    const modelAliases = closedStringArray(candidate.modelAliases, boundedIdentityPattern, 32);
    if (providerAliases === undefined || modelAliases === undefined) return undefined;
    providerModelObservations.push(Object.freeze({
      id: candidate.id,
      provider: candidate.provider,
      model: candidate.model,
      transport: candidate.transport,
      credentialName: candidate.credentialName,
      historicalDisposition: candidate.historicalDisposition as HistoricalDisposition,
      providerAliases,
      modelAliases,
      source: candidate.source,
    }));
  }
  if (new Set(providerModelObservations.map((observation) => observation.id)).size !== providerModelObservations.length) return undefined;
  providerModelObservations.sort((left, right) => left.id.localeCompare(right.id));

  return Object.freeze({
    $schema: "urn:usf:provider-legacy-observations:1",
    version: 1,
    sources: Object.freeze(sources.sort((left, right) => left.id.localeCompare(right.id))),
    credentialNames,
    credentialNameProvenance: Object.freeze({
      source: "reviewed-v2-untracked-environment-names-only",
      rawSourceDisposition: "secret-bearing-untracked-file-not-copied-or-digested",
      projectionDigest: value.credentialNameProvenance.projectionDigest,
    }),
    credentialAliasCandidates: Object.freeze(credentialAliasCandidates),
    nonAiServiceCredentialNames,
    hostTransports: Object.freeze(hostTransports),
    providerModelObservations: Object.freeze(providerModelObservations),
    nonclaims,
  });
}

async function readLegacyProviderConfig(repositoryRoot: string): Promise<LegacyProviderRead> {
  const path = resolve(repositoryRoot, legacyProviderConfigPath);
  let before;
  try { before = await lstat(path); }
  catch { return providersError("PROVIDERS_LEGACY_CONFIG_REFUSED", exitCodes.CURRENTNESS_FAILURE, "The tracked legacy provider observation source is unavailable."); }
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size < 2 || before.size > maximumLegacyProviderConfigBytes) {
    return providersError("PROVIDERS_LEGACY_CONFIG_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The legacy provider observation source is unsafe.");
  }
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = await handle.stat();
    if (!sameFile(before, opened)) return providersError("PROVIDERS_LEGACY_CONFIG_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The legacy provider observation source changed while opening.");
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (!sameFile(before, after) || bytes.byteLength !== before.size) return providersError("PROVIDERS_LEGACY_CONFIG_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The legacy provider observation source changed while reading.");
    let value: unknown;
    try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
    catch { return providersError("PROVIDERS_LEGACY_CONFIG_INVALID", exitCodes.CURRENTNESS_FAILURE, "The legacy provider observation source is not valid UTF-8 JSON."); }
    const config = parseLegacyProviderConfig(value);
    if (config === undefined) return providersError("PROVIDERS_LEGACY_CONFIG_INVALID", exitCodes.CURRENTNESS_FAILURE, "The legacy provider observation source does not satisfy its closed contract.");
    return Object.freeze({
      config,
      rawDigest: sha256(bytes),
      normalizedDigest: canonicalDigest(config, { rejectAbsolutePaths: true }),
    });
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function catalogueCredentialNames(snapshot: ModelCatalogueSnapshot): readonly string[] {
  return Object.freeze([...new Set(snapshot.providers.flatMap((provider) => provider.credentialNames))].sort());
}

function candidateCredentialNames(snapshot: ModelCatalogueSnapshot, config: ProviderConfig, legacy: LegacyProviderConfig): readonly string[] {
  return Object.freeze([...new Set([
    ...catalogueCredentialNames(snapshot),
    ...config.routes.map((route) => route.credentialName),
    ...legacy.credentialNames,
  ])].sort());
}

function catalogueMatches(snapshot: ModelCatalogueSnapshot, route: ProviderRouteConfig): readonly CatalogueModelView[] {
  const provider = snapshot.providers.find((candidate) => candidate.providerRoute === route.provider);
  if (provider === undefined) return Object.freeze([]);
  return Object.freeze(provider.models
    .filter((model) => model.route.model === route.model)
    .map((model) => Object.freeze({
      providerRoute: provider.providerRoute,
      providerName: provider.name,
      adapter: provider.adapter,
      credentialNames: provider.credentialNames,
      model,
    })));
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

async function configuredRouteRows(
  repositoryRoot: string,
  snapshot: ModelCatalogueSnapshot,
  config: ProviderConfig,
  credentials: CredentialPresenceObservation,
): Promise<readonly Readonly<Record<string, unknown>>[]> {
  const presence = new Map(credentials.credentials.map((credential) => [credential.name, credential.present] as const));
  const rows = await Promise.all(config.routes.map(async (route) => {
    const matches = catalogueMatches(snapshot, route);
    const exact = matches.length === 1 ? matches[0]! : undefined;
    const adapter = await observeInstalledAdapter(repositoryRoot, route.adapterPackage);
    const reasons = [
      ...(matches.length === 0 ? ["CATALOGUE_IDENTITY_UNMATCHED"] : []),
      ...(matches.length > 1 ? ["AMBIGUOUS_IDENTITY"] : []),
      ...(adapter === undefined ? ["ADAPTER_UNAVAILABLE"] : []),
      ...(presence.get(route.credentialName) === true ? [] : ["CREDENTIAL_MISSING"]),
      ...(route.paidFallback || route.cost === "paid" || route.cost === "unknown" ? ["PAID_OR_UNKNOWN_ECONOMICS"] : []),
      "ACCOUNT_RECEIPT_MISSING",
      "AUTHENTICATED_ANSWER_MISSING",
      "HIDDEN_HOLDOUT_MISSING",
      "UNQUALIFIED",
    ];
    return Object.freeze({
      kind: "configured-route",
      id: route.id,
      providerFamily: route.family,
      provider: route.provider,
      providerRoute: exact?.providerRoute ?? route.provider,
      requestedModel: route.model,
      routeModel: exact?.model.route.model ?? null,
      underlyingFamily: exact?.model.underlying.family ?? null,
      underlyingModel: exact?.model.underlying.model ?? null,
      adapterPackage: route.adapterPackage,
      adapterInstalledVersion: adapter?.version ?? null,
      adapterLockDigest: adapter?.lockDigest ?? null,
      credentialName: route.credentialName,
      credentialPresent: presence.get(route.credentialName) === true,
      catalogueIdentity: matches.length === 1 ? "exact" : matches.length === 0 ? "unmatched" : "ambiguous",
      capabilities: Object.freeze({
        configured: sortedUnique(route.capabilities),
        catalogue: sortedUnique(exact?.model.capabilityNames ?? []),
      }),
      economics: Object.freeze({
        declaredCost: route.cost,
        declaredEntitlement: route.entitlement,
        paidFallback: route.paidFallback,
        accountTierReceipt: "missing",
        status: "unverified",
      }),
      availability: "unknown",
      qualification: "UNQUALIFIED",
      allocation: "excluded",
      exclusionReasons: sortedUnique(reasons),
      sourceProvenance: Object.freeze(["models.dev", "v3-config"]),
    });
  }));
  return Object.freeze(rows.sort((left, right) => String(left.id).localeCompare(String(right.id))));
}

async function executableObserved(names: readonly string[]): Promise<boolean> {
  for (const name of names) {
    for (const directory of ["/usr/bin", "/usr/local/bin"]) {
      try {
        await access(resolve(directory, name), constants.X_OK);
        return true;
      } catch {
        // Absence in one fixed system directory does not decide the candidate.
      }
    }
  }
  return false;
}

async function hostTransportRows(hostTransports: readonly LegacyHostTransport[]): Promise<readonly Readonly<Record<string, unknown>>[]> {
  return Object.freeze(await Promise.all(hostTransports.map(async (transport) => {
    const installed = await executableObserved(transport.executableNames);
    return Object.freeze({
      kind: "host-transport",
      id: transport.id,
      transport: transport.id,
      executableObserved: installed,
      requestedModel: null,
      actualModel: null,
      credentialName: null,
      availability: installed ? "unknown" : "unavailable",
      qualification: "UNQUALIFIED",
      allocation: "excluded",
      exclusionReasons: Object.freeze(installed
        ? ["ACCOUNT_RECEIPT_MISSING", "AMBIGUOUS_IDENTITY", "AUTHENTICATED_ANSWER_MISSING", "HIDDEN_HOLDOUT_MISSING", "UNQUALIFIED"]
        : ["UNAVAILABLE", "UNQUALIFIED"]),
      sourceProvenance: Object.freeze(["host-observation", "reviewed-v2-workforce"]),
    });
  })));
}

function legacyProviderRows(
  observations: readonly LegacyProviderObservation[],
  credentials: CredentialPresenceObservation,
): readonly Readonly<Record<string, unknown>>[] {
  const presence = new Map(credentials.credentials.map((credential) => [credential.name, credential.present] as const));
  return Object.freeze(observations.map((observation) => {
    const reasons = [
      "ACCOUNT_RECEIPT_MISSING",
      "AUTHENTICATED_ANSWER_MISSING",
      "HIDDEN_HOLDOUT_MISSING",
      "HISTORICAL_ONLY",
      "UNQUALIFIED",
      ...(observation.historicalDisposition === "unavailable" ? ["PAID_OR_UNKNOWN_ECONOMICS"] : []),
      ...(observation.historicalDisposition === "deferred" ? ["AMBIGUOUS_IDENTITY"] : []),
    ];
    return Object.freeze({
      kind: "legacy-provider-observation",
      id: observation.id,
      provider: observation.provider,
      observedModel: observation.model,
      transport: observation.transport,
      credentialName: observation.credentialName,
      credentialPresent: observation.credentialName === null ? null : presence.get(observation.credentialName) === true,
      historicalDisposition: observation.historicalDisposition,
      providerAliases: observation.providerAliases,
      modelAliases: observation.modelAliases,
      availability: "unknown",
      qualification: "UNQUALIFIED",
      allocation: "excluded",
      exclusionReasons: sortedUnique(reasons),
      sourceProvenance: Object.freeze([observation.source]),
      nonClaim: "historical-observation-is-not-current-configuration-entitlement-availability-or-qualification",
    });
  }).sort((left, right) => left.id.localeCompare(right.id)));
}

function aliasRows(snapshot: ModelCatalogueSnapshot, config: ProviderConfig, legacy: LegacyProviderConfig): readonly Readonly<Record<string, unknown>>[] {
  const catalogueNames = new Set(catalogueCredentialNames(snapshot));
  const nonAiServiceCredentialNames = new Set(legacy.nonAiServiceCredentialNames);
  const explicitCredentialAliasCandidates = new Map(legacy.credentialAliasCandidates.map((candidate) => [candidate.source, candidate.targets] as const));
  const routeAliases = config.routes.map((route) => {
    const matches = catalogueMatches(snapshot, route);
    const exact = matches.length === 1 ? matches[0]! : undefined;
    const targets = exact === undefined ? [] : [
      `${exact.providerRoute}/${exact.model.route.model}`,
      `${exact.model.underlying.family ?? "unknown"}/${exact.model.underlying.model}`,
    ];
    return Object.freeze({
      kind: "identity-alias",
      id: `route:${route.id}`,
      aliasKind: "configured-route",
      sourceIdentity: route.id,
      targetIdentities: sortedUnique(targets),
      mappingStatus: matches.length === 1 ? "exact" : "unresolved",
      scope: "provider-route",
      sourceProvenance: Object.freeze(["models.dev", "v3-config"]),
      nonClaim: "requested-route-and-underlying-model-identities-remain-distinct",
    });
  });
  const credentialAliases = legacy.credentialNames.map((name) => {
    const exact = catalogueNames.has(name);
    const candidates = explicitCredentialAliasCandidates.get(name) ?? [];
    const scope = nonAiServiceCredentialNames.has(name) ? "non-ai-service" : "provider-candidate";
    return Object.freeze({
      kind: "identity-alias",
      id: `credential:${name}`,
      aliasKind: "legacy-credential",
      sourceIdentity: name,
      targetIdentities: exact ? Object.freeze([name]) : sortedUnique(candidates),
      mappingStatus: scope === "non-ai-service" ? "distinct" : exact ? "exact" : candidates.length > 0 ? "unresolved" : "unmapped",
      scope,
      sourceProvenance: Object.freeze(["models.dev", "reviewed-v2-environment-name"]),
      nonClaim: "credential-name-mapping-is-not-entitlement-or-secret-evidence",
    });
  });
  const transportAliases = legacy.hostTransports.map((transport) => Object.freeze({
    kind: "identity-alias",
    id: `transport:${transport.id}`,
    aliasKind: "host-transport",
    sourceIdentity: transport.id,
    targetIdentities: Object.freeze(transport.apiCredentialCandidate === null ? [] : [transport.apiCredentialCandidate]),
    mappingStatus: "distinct",
    scope: "transport",
    sourceProvenance: Object.freeze(["reviewed-v2-workforce"]),
    nonClaim: "subscription-host-transport-is-not-an-api-provider-route",
  }));
  const legacyObservationAliases = legacy.providerModelObservations.map((observation) => Object.freeze({
    kind: "identity-alias",
    id: `legacy-observation:${observation.id}`,
    aliasKind: "legacy-provider-model",
    sourceIdentity: observation.id,
    targetIdentities: sortedUnique([
      ...observation.providerAliases.map((alias) => `provider:${alias}`),
      ...observation.modelAliases.map((alias) => `model:${alias}`),
    ]),
    mappingStatus: observation.providerAliases.length + observation.modelAliases.length > 0 ? "reviewed-historical" : "unmapped",
    scope: "historical-provider-model",
    sourceProvenance: Object.freeze([observation.source]),
    nonClaim: "reviewed-historical-alias-is-not-current-route-equivalence-or-qualification",
  }));
  return Object.freeze([...routeAliases, ...credentialAliases, ...transportAliases, ...legacyObservationAliases]
    .sort((left, right) => left.id.localeCompare(right.id)));
}

function rowMatches(row: Readonly<Record<string, unknown>>, parsed: ParsedArguments): boolean {
  if (parsed.route !== undefined && row.id !== parsed.route && row.sourceIdentity !== parsed.route) return false;
  if (parsed.provider !== undefined && row.provider !== parsed.provider && row.providerRoute !== parsed.provider) return false;
  if (parsed.transport !== undefined && row.transport !== parsed.transport && row.sourceIdentity !== parsed.transport) return false;
  if (parsed.credentialName !== undefined && row.credentialName !== parsed.credentialName && row.sourceIdentity !== parsed.credentialName) return false;
  return true;
}

const requireProviderLeafCompletion = createProviderLeafCompletionAuthorizer({
  validateProfile: validateVersionedProfile,
  validateManifest: validateRepositoryManifest,
  deriveOwnerWork: ({ repositoryRoot, manifest, profile, work }) => deriveWork(loadSemanticGraph(repositoryRoot, manifest), {
    profile,
    selector: work,
    maxItems: 1,
  }),
});

const dispatchRegisteredProviderLeaf = createProviderLeafDispatcher({ authorize: requireProviderLeafCompletion });

export const providersCommandHandler: CommandHandler = async ({ args, repositoryRoot }) => {
  const leafResult = await dispatchRegisteredProviderLeaf(args, repositoryRoot);
  if (leafResult !== null) return leafResult;
  const parsed = parseArguments(args);
  const scope = semanticScope(repositoryRoot, parsed);
  const [catalogue, config, legacyRead] = await Promise.all([
    readLocalCatalogue(repositoryRoot),
    readProviderConfig(repositoryRoot),
    readLegacyProviderConfig(repositoryRoot),
  ]);
  const legacy = legacyRead.config;
  const credentialNames = candidateCredentialNames(catalogue.snapshot, config, legacy);
  const credentialPresenceNames = sortedUnique([
    ...config.routes.map((route) => route.credentialName),
    ...legacy.providerModelObservations.flatMap((observation) => observation.credentialName === null ? [] : [observation.credentialName]),
  ]);
  let credentials: CredentialPresenceObservation;
  try {
    credentials = await inspectCredentialPresence(repositoryRoot, parsed.envFile, credentialPresenceNames);
  } catch (error) {
    if (error instanceof CredentialInspectionError) {
      return providersError(
        error.reasonCode === "CREDENTIAL_FILE_TRACKED" ? "PROVIDERS_ENV_FILE_TRACKED" : "PROVIDERS_GIT_UNAVAILABLE",
        error.reasonCode === "CREDENTIAL_FILE_TRACKED" ? exitCodes.CONTAINMENT_REFUSAL : exitCodes.CURRENTNESS_FAILURE,
        "The explicit provider credential input was refused.",
        { credentialReasonCode: error.reasonCode },
      );
    }
    if (error instanceof CredentialEnvError) {
      return providersError("PROVIDERS_ENV_FILE_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The explicit provider credential input was refused.", { credentialReasonCode: error.reasonCode });
    }
    throw error;
  }

  const [routes, transports] = await Promise.all([
    configuredRouteRows(repositoryRoot, catalogue.snapshot, config, credentials),
    hostTransportRows(legacy.hostTransports),
  ]);
  const legacyProviders = legacyProviderRows(legacy.providerModelObservations, credentials);
  const operationItems = parsed.operation === "aliases" ? aliasRows(catalogue.snapshot, config, legacy) : [...routes, ...legacyProviders, ...transports];
  const matched = operationItems.filter((row) => rowMatches(row, parsed));
  const items = matched.slice(0, parsed.maxItems);
  const configuredFamilies = new Set(config.routes.map((route) => route.family));
  const configuredModels = new Set(config.routes.map((route) => `${route.provider}\u0000${route.model}`));
  const configuredInstalledAdapters = new Set(routes.flatMap((route) => route.adapterInstalledVersion === null ? [] : [String(route.adapterPackage)]));
  const observedHostTransports = transports.filter((transport) => transport.executableObserved === true).length;
  const legacyCredentialSetDigest = legacy.credentialNameProvenance.projectionDigest;
  const hostTransportSetDigest = canonicalDigest({
    schema: "urn:usf:host-transport-candidates:1",
    transports: legacy.hostTransports,
  }, { rejectAbsolutePaths: true });
  const legacyProviderObservationSetDigest = canonicalDigest({
    schema: "urn:usf:reviewed-legacy-provider-observations:1",
    observations: legacy.providerModelObservations,
  }, { rejectAbsolutePaths: true });
  return {
    output: Object.freeze({
      schema: "urn:usf:provider-census-result:1",
      status: "ok",
      operation: parsed.operation,
      externalContact: false,
      authorityEffect: "none",
      semanticScope: scope,
      source: Object.freeze({
        catalogueRawDigest: catalogue.snapshot.rawDigest,
        catalogueNormalizedDigest: catalogue.snapshot.normalizedDigest,
        providerConfigDigest: canonicalDigest(config, { rejectAbsolutePaths: true }),
        legacyCredentialSetDigest,
        hostTransportSetDigest,
        legacyProviderObservationSetDigest,
        legacyObservationRawDigest: legacyRead.rawDigest,
        legacyObservationNormalizedDigest: legacyRead.normalizedDigest,
        credentialSource: credentials.source,
      }),
      denominators: Object.freeze({
        catalogueProviderRoutes: catalogue.snapshot.denominators.providerRoutes,
        catalogueModelRoutes: catalogue.snapshot.denominators.modelRoutes,
        catalogueUnderlyingModels: catalogue.snapshot.denominators.underlyingModels,
        catalogueUnderlyingFamilies: catalogue.snapshot.denominators.underlyingFamilies,
        catalogueCredentialNames: catalogue.snapshot.denominators.credentialNames,
        configuredRoutes: config.routes.length,
        configuredProviderFamilies: configuredFamilies.size,
        configuredModels: configuredModels.size,
        candidateCredentialNames: credentialNames.length,
        credentialPresenceNames: credentialPresenceNames.length,
        reviewedLegacyCredentialNames: legacy.credentialNames.length,
        reviewedLegacyProviderObservations: legacy.providerModelObservations.length,
        installedAdapters: catalogue.snapshot.denominators.installedAdapterPackages,
        configuredInstalledAdapters: configuredInstalledAdapters.size,
        hostTransports: legacy.hostTransports.length,
        observedHostTransports,
        matchedItems: matched.length,
      }),
      truncation: Object.freeze({
        maxItems: parsed.maxItems,
        matchedItems: matched.length,
        returnedItems: items.length,
        truncated: matched.length > items.length,
      }),
      items: Object.freeze(items),
      nonclaims: Object.freeze([
        "catalogue-credential-adapter-and-executable-observations-are-not-availability-or-qualification",
        "host-transport-presence-does-not-identify-the-current-session-model",
        "legacy-credential-names-are-public-metadata-not-secret-or-entitlement-evidence",
        "reviewed-v2-provider-model-observations-are-historical-provenance-not-current-route-authority",
        "no-provider-contact-account-tier-proof-authenticated-answer-or-hidden-holdout-occurred",
        "no-semantic-git-runtime-or-proof-authority-effect",
      ]),
    }),
    exitCode: exitCodes.SUCCESS,
  };
};
