import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, realpath, rename, unlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { relative, resolve, sep } from "node:path";
import { canonicalDigest, canonicalJson } from "../core/canonical.ts";
import { exitCodes, UsfError } from "../core/errors.ts";
import {
  ModelCatalogueError,
  filterCatalogueModels,
  normalizeModelsDevCatalogue,
  type CatalogueCapability,
  type CatalogueFilter,
  type CatalogueModelView,
  type ModelCatalogueSnapshot,
} from "../providers/catalogue.ts";
import type { CommandHandler } from "./dispatcher.ts";

const catalogueUrl = "https://models.dev/api.json";
const rawCataloguePath = ".usf/catalog/models-dev.raw.json";
const normalizedCataloguePath = ".usf/catalog/models-dev.normalized.json";
const defaultMaxItems = 50;
const maximumMaxItems = 1_000;
const defaultMaximumBytes = 16 * 1024 * 1024;
const maximumMaximumBytes = 32 * 1024 * 1024;
const defaultTimeoutMs = 10_000;
const maximumTimeoutMs = 30_000;
const maximumPackageManifestBytes = 256 * 1024;
const maximumLockfileBytes = 4 * 1024 * 1024;
const packageNamePattern = /^(?:@[a-z0-9][a-z0-9._-]{0,127}\/)?[a-z0-9][a-z0-9._-]{0,127}$/u;
const boundedTokenPattern = /^[^\s\\\u0000-\u001f\u007f]{1,2048}$/u;
const credentialNamePattern = /^[A-Z0-9_]{1,128}$/u;
const capabilities = new Set<CatalogueCapability>([
  "attachment",
  "reasoning",
  "structured-output",
  "temperature",
  "tool-call",
]);

type ModelsOperation = "summary" | "list" | "refresh";

interface ParsedModelsArguments {
  readonly operation: ModelsOperation;
  readonly maxItems: number;
  readonly maximumBytes: number;
  readonly timeoutMs: number;
  readonly filter: CatalogueFilter;
  readonly filterOutput: Readonly<Record<string, string | null>>;
}

export interface CatalogueRead {
  readonly rawBytes: Buffer;
  readonly normalizedBytes: Buffer;
  readonly snapshot: ModelCatalogueSnapshot;
}

export interface InstalledAdapterObservation {
  readonly package: string;
  readonly version: string;
  /** Digest of the exact package, installed version, and pnpm artifact integrity. */
  readonly lockDigest: `sha256:${string}`;
}

function invalidArguments(message: string): never {
  throw new UsfError("MODELS_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, message);
}

function boundedInteger(value: string | undefined, fallback: number, maximum: number, option: string, minimum = 1): number {
  if (value === undefined) return fallback;
  if (!/^[1-9][0-9]{0,8}$/u.test(value)) invalidArguments(`${option} must be a bounded positive integer.`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) invalidArguments(`${option} is outside its supported bound.`);
  return number;
}

function safeToken(value: string | undefined, option: string, pattern = boundedTokenPattern): string | undefined {
  if (value === undefined) return undefined;
  if (!pattern.test(value)) invalidArguments(`${option} must be a bounded identifier.`);
  return value;
}

function parseModelsArguments(args: readonly string[]): ParsedModelsArguments {
  const operation = args[0];
  if (operation !== "summary" && operation !== "list" && operation !== "refresh") {
    invalidArguments("Models requires exactly one of summary, list or refresh.");
  }
  const remaining = args.slice(1);
  if (remaining.length % 2 !== 0) invalidArguments("Models options require explicit values.");
  const values = new Map<string, string>();
  for (let index = 0; index < remaining.length; index += 2) {
    const option = remaining[index]!;
    const value = remaining[index + 1]!;
    if (!option.startsWith("--") || value.length === 0 || value.startsWith("--") || values.has(option)) {
      invalidArguments("Models options must be unique flag/value pairs.");
    }
    values.set(option, value);
  }
  const common = new Set([
    "--max-items",
    "--provider-route",
    "--model",
    "--underlying-family",
    "--underlying-model",
    "--capability",
    "--credential-name",
    "--adapter",
    "--catalogue-price",
  ]);
  const allowed = operation === "refresh" ? new Set([...common, "--timeout-ms", "--max-bytes"]) : common;
  for (const option of values.keys()) if (!allowed.has(option)) invalidArguments("Unknown models option.");

  const providerRoute = safeToken(values.get("--provider-route"), "--provider-route");
  const routeModel = safeToken(values.get("--model"), "--model");
  const underlyingFamily = safeToken(values.get("--underlying-family"), "--underlying-family");
  const underlyingModel = safeToken(values.get("--underlying-model"), "--underlying-model");
  const credentialName = safeToken(values.get("--credential-name"), "--credential-name", credentialNamePattern);
  const capability = values.get("--capability") as CatalogueCapability | undefined;
  if (capability !== undefined && !capabilities.has(capability)) invalidArguments("--capability is not a normalized models.dev capability.");
  const adapter = values.get("--adapter") ?? "any";
  if (adapter !== "any" && adapter !== "installed") invalidArguments("--adapter must be any or installed.");
  const cataloguePrice = values.get("--catalogue-price") as "known" | "unknown" | "zero-price" | undefined;
  if (cataloguePrice !== undefined && !["known", "unknown", "zero-price"].includes(cataloguePrice)) {
    invalidArguments("--catalogue-price must be known, unknown or zero-price.");
  }

  return Object.freeze({
    operation,
    maxItems: boundedInteger(values.get("--max-items"), defaultMaxItems, maximumMaxItems, "--max-items"),
    maximumBytes: boundedInteger(values.get("--max-bytes"), defaultMaximumBytes, maximumMaximumBytes, "--max-bytes", 1_024),
    timeoutMs: boundedInteger(values.get("--timeout-ms"), defaultTimeoutMs, maximumTimeoutMs, "--timeout-ms", 250),
    filter: Object.freeze({
      ...(providerRoute === undefined ? {} : { providerRoutes: Object.freeze([providerRoute]) }),
      ...(routeModel === undefined ? {} : { routeModels: Object.freeze([routeModel]) }),
      ...(underlyingFamily === undefined ? {} : { underlyingFamilies: Object.freeze([underlyingFamily]) }),
      ...(underlyingModel === undefined ? {} : { underlyingModels: Object.freeze([underlyingModel]) }),
      ...(capability === undefined ? {} : { capabilities: Object.freeze([capability]) }),
      ...(credentialName === undefined ? {} : { credentialNames: Object.freeze([credentialName]) }),
      ...(adapter === "installed" ? { installedAdapter: true } : {}),
      ...(cataloguePrice === undefined ? {} : { cataloguePrice }),
    }),
    filterOutput: Object.freeze({
      providerRoute: providerRoute ?? null,
      routeModel: routeModel ?? null,
      underlyingFamily: underlyingFamily ?? null,
      underlyingModel: underlyingModel ?? null,
      capability: capability ?? null,
      credentialName: credentialName ?? null,
      adapter,
      cataloguePrice: cataloguePrice ?? null,
    }),
  });
}

function ownedByCurrentUser(uid: number): boolean {
  return typeof process.getuid === "function" && uid === process.getuid();
}

async function assertPrivateDirectory(path: string, reasonCode: string): Promise<void> {
  let metadata;
  try { metadata = await lstat(path); }
  catch { throw new UsfError(reasonCode, exitCodes.CONTAINMENT_REFUSAL, "The models catalogue directory is unavailable or unsafe."); }
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || !ownedByCurrentUser(metadata.uid) || (metadata.mode & 0o077) !== 0) {
    throw new UsfError(reasonCode, exitCodes.CONTAINMENT_REFUSAL, "The models catalogue directory is unavailable or unsafe.");
  }
}

function sameFile(left: Awaited<ReturnType<typeof lstat>>, right: Awaited<ReturnType<Awaited<ReturnType<typeof open>>["stat"]>>): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

async function readStableContainedRegularFile(repositoryRoot: string, path: string, maximumBytes: number): Promise<Buffer | undefined> {
  const canonicalRoot = await realpath(repositoryRoot);
  const canonicalPath = await realpath(path).catch(() => undefined);
  if (canonicalPath === undefined || !contained(canonicalRoot, canonicalPath)) return undefined;
  const before = await lstat(canonicalPath).catch(() => undefined);
  if (before === undefined || !before.isFile() || before.isSymbolicLink() || before.size > maximumBytes) return undefined;
  const handle = await open(canonicalPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (!sameFile(before, opened)) return undefined;
    const bytes = await handle.readFile();
    const after = await handle.stat();
    return sameFile(before, after) && bytes.length === before.size ? bytes : undefined;
  } finally {
    await handle.close();
  }
}

async function readPrivateCatalogueFile(repositoryRoot: string, repositoryPath: string, maximumBytes: number): Promise<Buffer> {
  const usfRoot = resolve(repositoryRoot, ".usf");
  const catalogRoot = resolve(usfRoot, "catalog");
  const path = resolve(repositoryRoot, repositoryPath);
  await assertPrivateDirectory(usfRoot, "MODELS_CATALOGUE_REFUSED");
  await assertPrivateDirectory(catalogRoot, "MODELS_CATALOGUE_REFUSED");
  let before;
  try { before = await lstat(path); }
  catch (error) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new UsfError("MODELS_CATALOGUE_PAIR_MISSING", exitCodes.CURRENTNESS_FAILURE, "The frozen raw/normalized models.dev pair is incomplete; run usf models refresh explicitly.");
    }
    throw new UsfError("MODELS_CATALOGUE_UNREADABLE", exitCodes.CURRENTNESS_FAILURE, "The frozen local models.dev catalogue cannot be read.");
  }
  if (!before.isFile() || before.isSymbolicLink() || !ownedByCurrentUser(before.uid) || before.nlink !== 1 || (before.mode & 0o7777) !== 0o600 || before.size > maximumBytes) {
    throw new UsfError("MODELS_CATALOGUE_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The frozen catalogue must be one private bounded regular file.");
  }
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const after = await handle.stat();
    if (!sameFile(before, after)) throw new UsfError("MODELS_CATALOGUE_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The frozen catalogue changed while opening it.");
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

function contained(repositoryRoot: string, path: string): boolean {
  const relation = relative(repositoryRoot, path);
  return relation !== "" && relation !== ".." && !relation.startsWith(`..${sep}`);
}

async function declaredDependencies(repositoryRoot: string): Promise<ReadonlySet<string>> {
  const path = resolve(repositoryRoot, "package.json");
  let metadata;
  try { metadata = await lstat(path); }
  catch { return new Set(); }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > maximumPackageManifestBytes) return new Set();
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return new Set();
    const dependencies = (parsed as Record<string, unknown>).dependencies;
    if (typeof dependencies !== "object" || dependencies === null || Array.isArray(dependencies)) return new Set();
    return new Set(Object.keys(dependencies as Record<string, unknown>).filter((name) => packageNamePattern.test(name)));
  } catch {
    return new Set();
  }
}

async function installedAdapterVersions(repositoryRoot: string, packages: readonly string[]): Promise<Readonly<Record<string, string>>> {
  const declared = await declaredDependencies(repositoryRoot);
  const require = createRequire(resolve(repositoryRoot, "package.json"));
  const canonicalRoot = await realpath(repositoryRoot);
  const versions: Record<string, string> = {};
  for (const packageName of [...new Set(packages)].sort()) {
    if (!packageNamePattern.test(packageName) || !declared.has(packageName)) continue;
    try {
      const manifestPath = await realpath(require.resolve(`${packageName}/package.json`));
      if (!contained(canonicalRoot, manifestPath)) continue;
      const metadata = await lstat(manifestPath);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > maximumPackageManifestBytes) continue;
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
      if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) continue;
      const name = (manifest as Record<string, unknown>).name;
      const version = (manifest as Record<string, unknown>).version;
      if (name === packageName && typeof version === "string" && boundedTokenPattern.test(version)) versions[packageName] = version;
    } catch {
      // Missing, externally resolved or malformed packages remain explicitly uninstalled.
    }
  }
  return Object.freeze(versions);
}

function pnpmIntegrity(lockfile: string, packageName: string, version: string): string | undefined {
  const wanted = new Set([`${packageName}@${version}:`, `'${packageName}@${version}':`, `"${packageName}@${version}":`]);
  const lines = lockfile.split(/\r?\n/u);
  const matches: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!line.startsWith("  ") || line.startsWith("    ") || !wanted.has(line.trim())) continue;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const candidate = lines[cursor]!;
      if (candidate.trim() !== "" && (!candidate.startsWith("  ") || !candidate.startsWith("    "))) break;
      const integrity = /^\s{4}resolution:\s*\{integrity:\s*([^,}\s]+)[^}]*\}\s*$/u.exec(candidate)?.[1];
      if (integrity !== undefined) matches.push(integrity);
    }
  }
  return matches.length === 1 && boundedTokenPattern.test(matches[0]) ? matches[0] : undefined;
}

/**
 * Re-observe one declared adapter from the current install and exact pnpm
 * artifact integrity. Unrelated lockfile entries do not perturb the digest.
 */
export async function observeInstalledAdapter(
  repositoryRoot: string,
  packageName: string,
): Promise<InstalledAdapterObservation | undefined> {
  if (!packageNamePattern.test(packageName)) return undefined;
  const require = createRequire(resolve(repositoryRoot, "package.json"));
  const canonicalRoot = await realpath(repositoryRoot);
  try {
    const manifestPath = await realpath(require.resolve(`${packageName}/package.json`));
    if (!contained(canonicalRoot, manifestPath)) return undefined;
    const manifestBytes = await readStableContainedRegularFile(repositoryRoot, manifestPath, maximumPackageManifestBytes);
    if (manifestBytes === undefined) return undefined;
    const manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes)) as unknown;
    if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) return undefined;
    const name = (manifest as Record<string, unknown>).name;
    const version = (manifest as Record<string, unknown>).version;
    if (name !== packageName || typeof version !== "string" || !boundedTokenPattern.test(version)) return undefined;

    const packageBytes = await readStableContainedRegularFile(repositoryRoot, resolve(repositoryRoot, "package.json"), maximumPackageManifestBytes);
    if (packageBytes === undefined) return undefined;
    const packageManifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(packageBytes)) as Record<string, unknown>;
    const dependencies = packageManifest.dependencies as Record<string, unknown> | undefined;
    if (dependencies?.[packageName] !== version) return undefined;
    const lockBytes = await readStableContainedRegularFile(repositoryRoot, resolve(repositoryRoot, "pnpm-lock.yaml"), maximumLockfileBytes);
    if (lockBytes === undefined) return undefined;
    const integrity = pnpmIntegrity(new TextDecoder("utf-8", { fatal: true }).decode(lockBytes), packageName, version);
    if (integrity === undefined) return undefined;
    return Object.freeze({
      package: packageName,
      version,
      lockDigest: canonicalDigest({ schema: "urn:usf:adapter-lock-observation:1", package: packageName, version, integrity }, { rejectAbsolutePaths: true }),
    });
  } catch {
    return undefined;
  }
}

function catalogueFailure(error: unknown): never {
  if (error instanceof ModelCatalogueError) {
    throw new UsfError("MODELS_CATALOGUE_INVALID", exitCodes.CURRENTNESS_FAILURE, "The frozen models.dev catalogue could not be normalized.", { catalogueReasonCode: error.reasonCode, cataloguePath: error.path });
  }
  throw error;
}

async function normalizeCatalogueForRefresh(repositoryRoot: string, bytes: Buffer, maximumBytes: number): Promise<ModelCatalogueSnapshot> {
  try {
    const inventory = normalizeModelsDevCatalogue(bytes, { maxRawBytes: maximumBytes });
    const packageNames = inventory.providers.flatMap((provider) => provider.adapter.package === null ? [] : [provider.adapter.package]);
    const installedAdapters = await installedAdapterVersions(repositoryRoot, packageNames);
    return normalizeModelsDevCatalogue(bytes, { installedAdapters, maxRawBytes: maximumBytes });
  } catch (error) {
    return catalogueFailure(error);
  }
}

function pairFailure(differencePath?: string): never {
  throw new UsfError("MODELS_CATALOGUE_PAIR_INVALID", exitCodes.CURRENTNESS_FAILURE, "The frozen raw/normalized models.dev pair could not be replayed exactly.", differencePath === undefined ? undefined : { differencePath });
}

function firstDifference(left: unknown, right: unknown, path = "$", budget = { remaining: 250_000 }): string | undefined {
  budget.remaining -= 1;
  if (budget.remaining < 0) return "$comparison-bound";
  if (Object.is(left, right)) return undefined;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return path;
    if (left.length !== right.length) return `${path}.length`;
    for (let index = 0; index < left.length; index += 1) {
      const difference = firstDifference(left[index], right[index], `${path}[${index}]`, budget);
      if (difference !== undefined) return difference;
    }
    return undefined;
  }
  if (typeof left === "object" && left !== null && typeof right === "object" && right !== null) {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)])].sort();
    for (const key of keys) {
      if (!(key in leftRecord) || !(key in rightRecord)) return `${path}.${key}`;
      const difference = firstDifference(leftRecord[key], rightRecord[key], `${path}.${key}`, budget);
      if (difference !== undefined) return difference;
    }
    return undefined;
  }
  return path;
}

function frozenInstalledAdapters(value: unknown): Readonly<Record<string, string>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return pairFailure();
  const providers = (value as Record<string, unknown>).providers;
  if (!Array.isArray(providers)) return pairFailure();
  const installed: Record<string, string> = {};
  for (const provider of providers) {
    if (typeof provider !== "object" || provider === null || Array.isArray(provider)) return pairFailure();
    const adapter = (provider as Record<string, unknown>).adapter;
    if (typeof adapter !== "object" || adapter === null || Array.isArray(adapter)) return pairFailure();
    const packageName = (adapter as Record<string, unknown>).package;
    const version = (adapter as Record<string, unknown>).installedVersion;
    if (packageName !== null && typeof packageName !== "string") return pairFailure();
    if (version !== null && (typeof version !== "string" || !boundedTokenPattern.test(version))) return pairFailure();
    if (version !== null && packageName === null) return pairFailure();
    if (typeof packageName === "string" && typeof version === "string") {
      if (!packageNamePattern.test(packageName)) return pairFailure();
      if (installed[packageName] !== undefined && installed[packageName] !== version) return pairFailure();
      installed[packageName] = version;
    }
  }
  return Object.freeze(installed);
}

function replayFrozenPair(rawBytes: Buffer, normalizedBytes: Buffer, maximumBytes: number): ModelCatalogueSnapshot {
  let normalizedText: string;
  let parsed: unknown;
  try {
    normalizedText = new TextDecoder("utf-8", { fatal: true }).decode(normalizedBytes);
    parsed = JSON.parse(normalizedText) as unknown;
  } catch {
    return pairFailure();
  }
  let canonical: string;
  try { canonical = canonicalJson(parsed); }
  catch { return pairFailure(); }
  if (canonical !== normalizedText) return pairFailure();
  try {
    const replayed = normalizeModelsDevCatalogue(rawBytes, {
      installedAdapters: frozenInstalledAdapters(parsed),
      maxRawBytes: maximumBytes,
    });
    if (canonicalJson(replayed) !== normalizedText) return pairFailure(firstDifference(parsed, replayed));
    return replayed;
  } catch (error) {
    if (error instanceof UsfError) throw error;
    return pairFailure();
  }
}

function maximumNormalizedBytes(maximumRawBytes: number): number {
  return Math.min(64 * 1024 * 1024, maximumRawBytes * 4);
}

export async function readLocalCatalogue(repositoryRoot: string, maximumBytes = defaultMaximumBytes): Promise<CatalogueRead> {
  const rawBytes = await readPrivateCatalogueFile(repositoryRoot, rawCataloguePath, maximumBytes);
  const normalizedBytes = await readPrivateCatalogueFile(repositoryRoot, normalizedCataloguePath, maximumNormalizedBytes(maximumBytes));
  return Object.freeze({
    rawBytes,
    normalizedBytes,
    snapshot: replayFrozenPair(rawBytes, normalizedBytes, maximumBytes),
  });
}

async function responseBytes(response: Response, maximumBytes: number): Promise<Buffer> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null && (!/^[0-9]+$/u.test(contentLength) || Number(contentLength) > maximumBytes)) {
    throw new UsfError("MODELS_REFRESH_TOO_LARGE", exitCodes.EXTERNAL_UNAVAILABLE, "The models.dev response exceeds the explicit byte bound.");
  }
  if (response.body === null) throw new UsfError("MODELS_REFRESH_UNAVAILABLE", exitCodes.EXTERNAL_UNAVAILABLE, "The models.dev response has no body.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new UsfError("MODELS_REFRESH_TOO_LARGE", exitCodes.EXTERNAL_UNAVAILABLE, "The models.dev response exceeds the explicit byte bound.");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}

async function fetchCatalogue(parsed: ParsedModelsArguments): Promise<Buffer> {
  let response: Response;
  try {
    response = await fetch(catalogueUrl, {
      method: "GET",
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(parsed.timeoutMs),
    });
  } catch {
    throw new UsfError("MODELS_REFRESH_UNAVAILABLE", exitCodes.EXTERNAL_UNAVAILABLE, "The bounded models.dev refresh request failed.");
  }
  const requested = new URL(catalogueUrl);
  let actual: URL;
  try { actual = new URL(response.url); }
  catch { throw new UsfError("MODELS_REFRESH_ORIGIN_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The models.dev refresh response origin is invalid."); }
  if (response.redirected || actual.protocol !== "https:" || actual.origin !== requested.origin || actual.pathname !== requested.pathname || actual.search !== "") {
    throw new UsfError("MODELS_REFRESH_ORIGIN_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The models.dev refresh response did not preserve the fixed HTTPS origin and path.");
  }
  if (!response.ok) throw new UsfError("MODELS_REFRESH_UNAVAILABLE", exitCodes.EXTERNAL_UNAVAILABLE, "The models.dev refresh returned a non-success status.", { status: response.status });
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw new UsfError("MODELS_REFRESH_INVALID", exitCodes.EXTERNAL_UNAVAILABLE, "The models.dev refresh did not return JSON.");
  try { return await responseBytes(response, parsed.maximumBytes); }
  catch (error) {
    if (error instanceof UsfError) throw error;
    throw new UsfError("MODELS_REFRESH_UNAVAILABLE", exitCodes.EXTERNAL_UNAVAILABLE, "The bounded models.dev response could not be read.");
  }
}

async function assertSafeExistingTarget(path: string): Promise<void> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || !ownedByCurrentUser(metadata.uid) || metadata.nlink !== 1 || (metadata.mode & 0o7777) !== 0o600) {
      throw new UsfError("MODELS_CATALOGUE_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "An unsafe existing catalogue target was refused.");
    }
  } catch (error) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}

async function atomicallyWriteCatalogue(repositoryRoot: string, rawBytes: Buffer, snapshot: ModelCatalogueSnapshot, maximumRawBytes: number): Promise<void> {
  const usfRoot = resolve(repositoryRoot, ".usf");
  const catalogRoot = resolve(usfRoot, "catalog");
  const rawTarget = resolve(repositoryRoot, rawCataloguePath);
  const normalizedTarget = resolve(repositoryRoot, normalizedCataloguePath);
  const normalizedBytes = Buffer.from(canonicalJson(snapshot), "utf8");
  if (normalizedBytes.byteLength > maximumNormalizedBytes(maximumRawBytes)) {
    throw new UsfError("MODELS_CATALOGUE_WRITE_FAILED", exitCodes.CONTAINMENT_REFUSAL, "The normalized catalogue exceeds its derived byte bound.");
  }
  await assertPrivateDirectory(usfRoot, "MODELS_CATALOGUE_REFUSED");
  try { await mkdir(catalogRoot, { mode: 0o700 }); }
  catch (error) {
    if (!(error instanceof Error) || (error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw new UsfError("MODELS_CATALOGUE_WRITE_FAILED", exitCodes.CONTAINMENT_REFUSAL, "The private catalogue directory could not be created.");
    }
  }
  await assertPrivateDirectory(catalogRoot, "MODELS_CATALOGUE_REFUSED");
  await assertSafeExistingTarget(rawTarget);
  await assertSafeExistingTarget(normalizedTarget);
  const nonce = `${process.pid}.${randomUUID()}`;
  const rawTemporary = resolve(catalogRoot, `.models-dev.raw.${nonce}.tmp`);
  const normalizedTemporary = resolve(catalogRoot, `.models-dev.normalized.${nonce}.tmp`);
  let rawHandle;
  let normalizedHandle;
  try {
    rawHandle = await open(rawTemporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    normalizedHandle = await open(normalizedTemporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    await rawHandle.writeFile(rawBytes);
    await normalizedHandle.writeFile(normalizedBytes);
    await rawHandle.sync();
    await normalizedHandle.sync();
    await rawHandle.close();
    rawHandle = undefined;
    await normalizedHandle.close();
    normalizedHandle = undefined;
    // A process failure between these renames leaves a mismatched pair. Local
    // readers replay both digests and therefore fail closed rather than
    // silently combining observations from different refreshes.
    await rename(normalizedTemporary, normalizedTarget);
    await rename(rawTemporary, rawTarget);
    const directory = await open(catalogRoot, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0));
    try { await directory.sync(); }
    finally { await directory.close(); }
  } catch (error) {
    if (rawHandle !== undefined) await rawHandle.close().catch(() => undefined);
    if (normalizedHandle !== undefined) await normalizedHandle.close().catch(() => undefined);
    await unlink(rawTemporary).catch(() => undefined);
    await unlink(normalizedTemporary).catch(() => undefined);
    if (error instanceof UsfError) throw error;
    throw new UsfError("MODELS_CATALOGUE_WRITE_FAILED", exitCodes.CONTAINMENT_REFUSAL, "The refreshed catalogue could not be written atomically.");
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function modelKey(item: CatalogueModelView): string {
  return `${item.model.underlying.family ?? "<unknown>"}\u0000${item.model.underlying.model}`;
}

function modelsOutput(
  parsed: ParsedModelsArguments,
  catalogue: CatalogueRead,
  externalContact: boolean,
): Readonly<Record<string, unknown>> {
  const matched = filterCatalogueModels(catalogue.snapshot, parsed.filter);
  const listRequested = parsed.operation === "list";
  const items = listRequested ? matched.slice(0, parsed.maxItems) : [];
  const matchedProviders = new Set(matched.map((item) => item.providerRoute));
  const matchedUnderlyingModels = new Set(matched.map(modelKey));
  const matchedUnderlyingFamilies = new Set(matched.flatMap((item) => item.model.underlying.family === null ? [] : [item.model.underlying.family]));
  return Object.freeze({
    schema: "urn:usf:models-result:1",
    status: "ok",
    operation: parsed.operation,
    externalContact,
    source: Object.freeze({
      catalogue: "models.dev/api.json",
      rawPath: rawCataloguePath,
      normalizedPath: normalizedCataloguePath,
      rawBytes: catalogue.rawBytes.byteLength,
      normalizedBytes: catalogue.normalizedBytes.byteLength,
      rawDigest: catalogue.snapshot.rawDigest,
      normalizedDigest: catalogue.snapshot.normalizedDigest,
      externalContact,
    }),
    filters: parsed.filterOutput,
    denominators: Object.freeze({
      catalogue: catalogue.snapshot.denominators,
      matchedProviderRoutes: matchedProviders.size,
      matchedModelRoutes: matched.length,
      matchedUnderlyingModels: matchedUnderlyingModels.size,
      matchedUnderlyingFamilies: matchedUnderlyingFamilies.size,
      returnedModelRoutes: items.length,
    }),
    truncation: Object.freeze({
      maxItems: parsed.maxItems,
      matchedItems: matched.length,
      returnedItems: items.length,
      truncated: listRequested && matched.length > items.length,
    }),
    coverage: Object.freeze({
      catalogueProviderObjectsNormalized: catalogue.snapshot.denominators.providerRoutes,
      catalogueModelObjectsNormalized: catalogue.snapshot.denominators.modelRoutes,
      installedAdapters: "declared-runtime-dependencies-resolved-inside-repository",
      credentialData: "names-only-from-public-catalogue",
      routeAvailability: "not-observed",
      entitlement: "not-observed",
      quota: "not-observed",
      health: "not-observed",
    }),
    items: Object.freeze(items),
    authorityEffect: externalContact ? "writes-ignored-catalogue-snapshot-only" : "none",
    nonclaims: Object.freeze([
      ...catalogue.snapshot.nonclaims,
      "catalogue-models-are-not-a-configured-provider-roster",
      "models-output-is-not-a-live-probe-or-availability-claim",
      "zero-catalogue-price-is-not-zero-paid-cost-proof",
      "no-semantic-authority-git-or-proof-effect",
    ].sort(compareText)),
  });
}

export const modelsCommandHandler: CommandHandler = async ({ args, repositoryRoot }) => {
  if (args[0] === "classify") {
    const { classifyCatalogueCommand } = await import("./classify.ts");
    return classifyCatalogueCommand(repositoryRoot, args.slice(1));
  }
  const parsed = parseModelsArguments(args);
  if (parsed.operation !== "refresh") {
    return { output: modelsOutput(parsed, await readLocalCatalogue(repositoryRoot, parsed.maximumBytes), false), exitCode: exitCodes.SUCCESS };
  }
  const bytes = await fetchCatalogue(parsed);
  const snapshot = await normalizeCatalogueForRefresh(repositoryRoot, bytes, parsed.maximumBytes);
  if (snapshot.denominators.providerRoutes === 0 || snapshot.denominators.modelRoutes === 0) {
    throw new UsfError("MODELS_REFRESH_INVALID", exitCodes.EXTERNAL_UNAVAILABLE, "The models.dev refresh returned an empty provider catalogue.");
  }
  await atomicallyWriteCatalogue(repositoryRoot, bytes, snapshot, parsed.maximumBytes);
  const frozen = await readLocalCatalogue(repositoryRoot, parsed.maximumBytes);
  return {
    output: modelsOutput(parsed, frozen, true),
    exitCode: exitCodes.SUCCESS,
  };
};
