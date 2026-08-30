import { constants, readFileSync, type Stats } from "node:fs";
import { lstat, open, type FileHandle } from "node:fs/promises";
import { createJsonSchemaValidator } from "../schema/index.ts";
import type { CostClass } from "./types.ts";

const providerConfigSchema = JSON.parse(
  readFileSync(new URL("../../schemas/provider-config.schema.json", import.meta.url), "utf8"),
) as unknown;
const validateProviderConfig = createJsonSchemaValidator<ProviderConfig>(providerConfigSchema);

const credentialNamePattern = /^[A-Z_][A-Z0-9_]{0,127}$/;
const maximumEnvBytes = 64 * 1024;
const maximumRoutes = 256;
const maximumCapabilities = 64;
const privacyClasses = new Set<PrivacyClass>([
  "public",
  "private-metadata",
  "private-source",
  "restricted",
]);

export type PrivacyClass = "public" | "private-metadata" | "private-source" | "restricted";
export type EntitlementClass =
  | "local"
  | "zero-price"
  | "free-quota"
  | "subscription"
  | "promotional-credit"
  | "paid"
  | "unknown";

export interface ProviderRouteConfig {
  readonly id: string;
  readonly family: string;
  readonly provider: string;
  readonly adapterPackage: string;
  readonly credentialName: string;
  /** Provider-route model identifier, not an inferred underlying-model identity. */
  readonly model: string;
  readonly capabilities: readonly string[];
  readonly privacy: readonly PrivacyClass[];
  readonly cost: CostClass;
  readonly entitlement: EntitlementClass;
  readonly paidFallback: boolean;
  readonly concurrency: number;
  readonly probeFreshnessSeconds: number;
}

export interface ProviderConfig {
  readonly $schema: "urn:usf:providers:1";
  readonly catalogueSource: "models.dev";
  readonly routes: readonly ProviderRouteConfig[];
}

export type ProviderConfigReason =
  | "PROVIDER_CONFIG_INVALID"
  | "PROVIDER_CONFIG_DUPLICATE_ROUTE"
  | "PROVIDER_CONFIG_DUPLICATE_CAPABILITY"
  | "PROVIDER_CONFIG_DUPLICATE_PRIVACY";

export type CredentialEnvReason =
  | "CREDENTIAL_ALLOWLIST_INVALID"
  | "CREDENTIAL_ENV_UNREADABLE"
  | "CREDENTIAL_ENV_REFUSED"
  | "CREDENTIAL_ENV_TOO_LARGE"
  | "CREDENTIAL_ENV_INVALID"
  | "CREDENTIAL_ENV_DUPLICATE"
  | "CREDENTIAL_NAME_NOT_ALLOWLISTED";

export class ProviderConfigError extends Error {
  readonly reasonCode: ProviderConfigReason;

  constructor(reasonCode: ProviderConfigReason) {
    super("The provider configuration does not satisfy the closed V3 provider schema.");
    this.name = "ProviderConfigError";
    this.reasonCode = reasonCode;
  }
}

export class CredentialEnvError extends Error {
  readonly reasonCode: CredentialEnvReason;
  readonly line: number | null;

  constructor(reasonCode: CredentialEnvReason, line: number | null = null) {
    super("The selected credential environment was refused.");
    this.name = "CredentialEnvError";
    this.reasonCode = reasonCode;
    this.line = line;
  }
}

export interface CredentialPresence {
  readonly name: string;
  readonly present: boolean;
}

export interface CredentialMetadata {
  readonly credentials: readonly CredentialPresence[];
}

/**
 * Keeps credential values in an ECMAScript private field. JSON serialization
 * and ordinary object inspection expose only the allowlisted names/presence.
 */
export class CredentialEnvironment {
  readonly metadata: CredentialMetadata;
  readonly #allowlist: ReadonlySet<string>;
  readonly #values: ReadonlyMap<string, string>;

  constructor(allowlist: readonly string[], values: ReadonlyMap<string, string>) {
    const names = [...allowlist].sort((left, right) => left.localeCompare(right));
    this.#allowlist = new Set(names);
    this.#values = new Map([...values].filter(([name]) => this.#allowlist.has(name)));
    this.metadata = Object.freeze({
      credentials: Object.freeze(names.map((name) => Object.freeze({
        name,
        present: this.#values.has(name),
      }))),
    });
    Object.freeze(this);
  }

  getCredential(name: string): string | undefined {
    if (!this.#allowlist.has(name)) {
      throw new CredentialEnvError("CREDENTIAL_NAME_NOT_ALLOWLISTED");
    }
    return this.#values.get(name);
  }

  hasCredential(name: string): boolean {
    if (!this.#allowlist.has(name)) {
      throw new CredentialEnvError("CREDENTIAL_NAME_NOT_ALLOWLISTED");
    }
    return this.#values.has(name);
  }

  toJSON(): CredentialMetadata {
    return this.metadata;
  }
}

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

function cloneRoute(route: ProviderRouteConfig): ProviderRouteConfig {
  return Object.freeze({
    id: route.id,
    family: route.family,
    provider: route.provider,
    adapterPackage: route.adapterPackage,
    credentialName: route.credentialName,
    model: route.model,
    capabilities: Object.freeze([...route.capabilities]),
    privacy: Object.freeze([...route.privacy]),
    cost: route.cost,
    entitlement: route.entitlement,
    paidFallback: route.paidFallback,
    concurrency: route.concurrency,
    probeFreshnessSeconds: route.probeFreshnessSeconds,
  });
}

/** Parse, close and freeze a tracked V3 provider configuration. */
export function parseProviderConfig(value: unknown): ProviderConfig {
  const result = validateProviderConfig.validate(value);
  if (!result.valid || result.value.routes.length > maximumRoutes) {
    throw new ProviderConfigError("PROVIDER_CONFIG_INVALID");
  }

  const routeIds = result.value.routes.map((route) => route.id);
  if (hasDuplicates(routeIds)) {
    throw new ProviderConfigError("PROVIDER_CONFIG_DUPLICATE_ROUTE");
  }

  for (const route of result.value.routes) {
    if (
      route.capabilities.length === 0 ||
      route.capabilities.length > maximumCapabilities ||
      route.privacy.length === 0 ||
      route.privacy.length > privacyClasses.size ||
      route.privacy.some((privacy) => !privacyClasses.has(privacy))
    ) {
      throw new ProviderConfigError("PROVIDER_CONFIG_INVALID");
    }
    if (hasDuplicates(route.capabilities)) {
      throw new ProviderConfigError("PROVIDER_CONFIG_DUPLICATE_CAPABILITY");
    }
    if (hasDuplicates(route.privacy)) {
      throw new ProviderConfigError("PROVIDER_CONFIG_DUPLICATE_PRIVACY");
    }
  }

  return Object.freeze({
    $schema: "urn:usf:providers:1",
    catalogueSource: "models.dev",
    routes: Object.freeze(result.value.routes.map(cloneRoute)),
  });
}

/** Unique credential names declared by configured routes, in stable order. */
export function providerCredentialNames(config: ProviderConfig): readonly string[] {
  return Object.freeze(
    [...new Set(config.routes.map((route) => route.credentialName))]
      .sort((left, right) => left.localeCompare(right)),
  );
}

function validAllowlist(names: readonly string[]): boolean {
  return names.every((name) => credentialNamePattern.test(name)) && !hasDuplicates(names);
}

function assertSecureFile(metadata: Stats): void {
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  if (
    uid === undefined ||
    metadata.isSymbolicLink() ||
    !metadata.isFile() ||
    metadata.uid !== uid ||
    (metadata.mode & 0o7777) !== 0o600 ||
    metadata.nlink !== 1
  ) {
    throw new CredentialEnvError("CREDENTIAL_ENV_REFUSED");
  }
  if (metadata.size > maximumEnvBytes) {
    throw new CredentialEnvError("CREDENTIAL_ENV_TOO_LARGE");
  }
}

function sameFile(
  before: Stats,
  after: Stats,
): boolean {
  return before.dev === after.dev &&
    before.ino === after.ino &&
    before.size === after.size &&
    before.mtimeMs === after.mtimeMs &&
    before.ctimeMs === after.ctimeMs;
}

function decodeEnv(bytes: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new CredentialEnvError("CREDENTIAL_ENV_INVALID");
  }
}

function parseEnvValue(raw: string, line: number): string {
  if (raw.length === 0 || raw.includes("\u0000")) {
    throw new CredentialEnvError("CREDENTIAL_ENV_INVALID", line);
  }
  const quote = raw[0];
  if (quote === "\"" || quote === "'") {
    if (raw.length < 3 || raw.at(-1) !== quote) {
      throw new CredentialEnvError("CREDENTIAL_ENV_INVALID", line);
    }
    const value = raw.slice(1, -1);
    if (value.length === 0 || value.includes("\u0000")) {
      throw new CredentialEnvError("CREDENTIAL_ENV_INVALID", line);
    }
    return value;
  }
  if (raw.trim() !== raw) {
    throw new CredentialEnvError("CREDENTIAL_ENV_INVALID", line);
  }
  return raw;
}

function parseCredentialText(text: string, allowlist: ReadonlySet<string>): ReadonlyMap<string, string> {
  const retained = new Map<string, string>();
  const observed = new Set<string>();
  const lines = text.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const line = lines[index]!;
    if (line.length === 0 || /^\s*#/.test(line)) continue;
    const separator = line.indexOf("=");
    if (separator < 1) {
      throw new CredentialEnvError("CREDENTIAL_ENV_INVALID", lineNumber);
    }
    const name = line.slice(0, separator);
    if (!credentialNamePattern.test(name)) {
      throw new CredentialEnvError("CREDENTIAL_ENV_INVALID", lineNumber);
    }
    if (observed.has(name)) {
      throw new CredentialEnvError("CREDENTIAL_ENV_DUPLICATE", lineNumber);
    }
    observed.add(name);
    const value = parseEnvValue(line.slice(separator + 1), lineNumber);
    if (allowlist.has(name)) retained.set(name, value);
  }
  return retained;
}

/**
 * Load one explicitly selected credential file without shell evaluation.
 * The selected path is never returned, and only allowlisted values survive
 * parsing. The caller must pass a literal path; this function has no default
 * and no knowledge of V1/V2/historical locations.
 */
export async function loadCredentialEnvFile(
  selectedPath: string,
  allowlist: readonly string[],
): Promise<CredentialEnvironment> {
  const selectedNames = [...allowlist];
  if (selectedPath.length === 0 || !validAllowlist(selectedNames)) {
    throw new CredentialEnvError("CREDENTIAL_ALLOWLIST_INVALID");
  }

  let pathMetadata: Awaited<ReturnType<typeof lstat>>;
  try {
    pathMetadata = await lstat(selectedPath);
  } catch {
    throw new CredentialEnvError("CREDENTIAL_ENV_UNREADABLE");
  }
  assertSecureFile(pathMetadata);

  let handle: FileHandle | undefined;
  try {
    handle = await open(selectedPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const openedMetadata = await handle.stat();
    assertSecureFile(openedMetadata);
    if (!sameFile(pathMetadata, openedMetadata)) {
      throw new CredentialEnvError("CREDENTIAL_ENV_REFUSED");
    }
    const bytes = await handle.readFile();
    const afterRead = await handle.stat();
    if (bytes.length > maximumEnvBytes) {
      throw new CredentialEnvError("CREDENTIAL_ENV_TOO_LARGE");
    }
    if (!sameFile(pathMetadata, afterRead) || bytes.length !== pathMetadata.size) {
      throw new CredentialEnvError("CREDENTIAL_ENV_REFUSED");
    }
    const names = selectedNames.sort((left, right) => left.localeCompare(right));
    const values = parseCredentialText(decodeEnv(bytes), new Set(names));
    return new CredentialEnvironment(names, values);
  } catch (error) {
    if (error instanceof CredentialEnvError) throw error;
    throw new CredentialEnvError("CREDENTIAL_ENV_UNREADABLE");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/** Compatibility spelling for command handlers; it has the same strict contract. */
export const loadCredentialEnvironment = loadCredentialEnvFile;
