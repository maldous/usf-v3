import { constants } from "node:fs";
import { lstat, open, readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

import { canonicalDigest, sha256 } from "../core/canonical.ts";
import { exitCodes, UsfError } from "../core/errors.ts";
import {
  CredentialEnvError,
  parseProviderConfig,
  ProviderConfigError,
  providerCredentialNames,
  type ProviderConfig,
} from "../providers/config.ts";
import {
  CredentialInspectionError,
  inspectCredentialPresence,
  type CredentialPresenceObservation,
} from "../providers/credentials.ts";
import { localGitChildEnvironment } from "../providers/local-git.ts";
import type { CommandHandler } from "./dispatcher.ts";
import { readLocalCatalogue } from "./models.ts";

const runFile = promisify(execFile);
const trackedInputs = Object.freeze({
  providerConfig: "config/providers.json",
  policy: "config/policy.json",
  privacy: "config/privacy.json",
});
const maximumTrackedBytes = 256 * 1024;
const maximumCatalogueBytes = 16 * 1024 * 1024;
const maximumManifestBytes = 256 * 1024;
const maximumExplicitPathLength = 4_096;
const packageNamePattern = /^(?:@[a-z0-9][a-z0-9._-]{0,127}\/)?[a-z0-9][a-z0-9._-]{0,127}$/u;
const versionPattern = /^[^\s\\\u0000-\u001f\u007f]{1,256}$/u;
const privacyClasses = new Set([
  "public",
  "private-metadata",
  "private-source",
  "restricted",
]);
const acceptedCostClasses = new Set(["local", "zero-price", "free-quota"]);

interface TrackedJson {
  readonly bytes: Buffer;
  readonly value: unknown | undefined;
  readonly jsonValid: boolean;
}

function doctorError(
  code: string,
  exitCode: (typeof exitCodes)[keyof typeof exitCodes],
  message: string,
  details?: Record<string, unknown>,
): never {
  throw new UsfError(code, exitCode, message, details);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function closed(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function uniqueStrings(value: unknown, allowed: ReadonlySet<string>): value is string[] {
  return Array.isArray(value) &&
    value.length > 0 &&
    value.length <= allowed.size &&
    value.every((item) => typeof item === "string" && allowed.has(item)) &&
    new Set(value).size === value.length;
}

function policyValid(value: unknown): boolean {
  if (!isRecord(value) || !closed(value, [
    "$schema",
    "maximumPaidCost",
    "paidFallback",
    "unknownPrice",
    "acceptedCostClasses",
  ])) return false;
  return value.$schema === "urn:usf:policy:1" &&
    value.maximumPaidCost === 0 &&
    value.paidFallback === "prohibited" &&
    value.unknownPrice === "ineligible" &&
    uniqueStrings(value.acceptedCostClasses, acceptedCostClasses);
}

function privacyValid(value: unknown): boolean {
  if (!isRecord(value) || !closed(value, [
    "$schema",
    "defaultClassification",
    "classifications",
    "externalRouteDefault",
    "restrictedRoutes",
  ])) return false;
  if (
    value.$schema !== "urn:usf:privacy:1" ||
    typeof value.defaultClassification !== "string" ||
    !privacyClasses.has(value.defaultClassification) ||
    !uniqueStrings(value.classifications, privacyClasses) ||
    new Set(value.classifications).size !== privacyClasses.size ||
    !uniqueStrings(value.externalRouteDefault, privacyClasses) ||
    !Array.isArray(value.restrictedRoutes) ||
    value.restrictedRoutes.length > 64 ||
    value.restrictedRoutes.some(
      (item) =>
        typeof item !== "string" ||
        !/^[a-z0-9][a-z0-9._:-]{0,95}$/u.test(item),
    ) ||
    new Set(value.restrictedRoutes).size !== value.restrictedRoutes.length
  ) return false;
  return true;
}

function contained(root: string, path: string): boolean {
  const relation = relative(root, path);
  return relation !== "" && relation !== ".." && !relation.startsWith(`..${sep}`);
}

async function gitTracked(
  repositoryRoot: string,
  repositoryPath: string,
  environmentRoot = repositoryRoot,
): Promise<boolean> {
  try {
    await runFile("git", [
      "-C",
      repositoryRoot,
      "ls-files",
      "--error-unmatch",
      "--",
      repositoryPath,
    ], {
      encoding: "utf8",
      timeout: 5_000,
      maxBuffer: 16 * 1024,
      env: localGitChildEnvironment(environmentRoot),
    });
    return true;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === 1 || code === "1") return false;
    doctorError(
      "DOCTOR_GIT_UNAVAILABLE",
      exitCodes.CURRENTNESS_FAILURE,
      "Git could not verify tracked local inputs.",
    );
  }
}

function sameFile(
  before: Awaited<ReturnType<typeof lstat>>,
  after: Awaited<ReturnType<Awaited<ReturnType<typeof open>>["stat"]>>,
): boolean {
  return before.dev === after.dev &&
    before.ino === after.ino &&
    before.size === after.size &&
    before.mtimeMs === after.mtimeMs &&
    before.ctimeMs === after.ctimeMs;
}

async function readBoundedRegularFile(
  path: string,
  maximumBytes: number,
  reasonCode: string,
  privateFile: boolean,
): Promise<Buffer> {
  let before;
  try {
    before = await lstat(path);
  } catch {
    doctorError(reasonCode, exitCodes.CURRENTNESS_FAILURE, "A required local doctor input is unavailable.");
  }
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1 ||
    before.size > maximumBytes ||
    (privateFile &&
      (uid === undefined || before.uid !== uid || (before.mode & 0o7777) !== 0o600))
  ) {
    doctorError(reasonCode, exitCodes.CONTAINMENT_REFUSAL, "An unsafe local doctor input was refused.");
  }
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = await handle.stat();
    if (!sameFile(before, opened)) {
      doctorError(reasonCode, exitCodes.CONTAINMENT_REFUSAL, "A local doctor input changed while opening.");
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (!sameFile(before, after) || bytes.length !== before.size) {
      doctorError(reasonCode, exitCodes.CONTAINMENT_REFUSAL, "A local doctor input changed while reading.");
    }
    return bytes;
  } catch (error) {
    if (error instanceof UsfError) throw error;
    return doctorError(reasonCode, exitCodes.CONTAINMENT_REFUSAL, "A local doctor input could not be read safely.");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function readTrackedJson(
  repositoryRoot: string,
  repositoryPath: string,
): Promise<TrackedJson> {
  if (!(await gitTracked(repositoryRoot, repositoryPath))) {
    doctorError(
      "DOCTOR_TRACKED_INPUT_REQUIRED",
      exitCodes.CONTAINMENT_REFUSAL,
      "Doctor authority inputs must be tracked by the local repository.",
    );
  }
  const bytes = await readBoundedRegularFile(
    resolve(repositoryRoot, repositoryPath),
    maximumTrackedBytes,
    "DOCTOR_TRACKED_INPUT_REFUSED",
    false,
  );
  try {
    return Object.freeze({
      bytes,
      value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown,
      jsonValid: true,
    });
  } catch {
    return Object.freeze({ bytes, value: undefined, jsonValid: false });
  }
}

async function assertPrivateDirectory(path: string, reasonCode: string): Promise<void> {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch {
    doctorError(reasonCode, exitCodes.CONTAINMENT_REFUSAL, "A private USF directory is unavailable.");
  }
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o077) !== 0 ||
    typeof process.getuid !== "function" ||
    metadata.uid !== process.getuid()
  ) {
    doctorError(reasonCode, exitCodes.CONTAINMENT_REFUSAL, "A private USF directory was refused.");
  }
}

async function validateProviderHome(repositoryRoot: string): Promise<void> {
  const runtimeRoot = resolve(repositoryRoot, ".usf");
  const providerHome = resolve(runtimeRoot, "home");
  await assertPrivateDirectory(runtimeRoot, "DOCTOR_PROVIDER_HOME_REFUSED");
  await assertPrivateDirectory(providerHome, "DOCTOR_PROVIDER_HOME_REFUSED");
  let canonicalRepository: string;
  let canonicalHome: string;
  try {
    canonicalRepository = await realpath(repositoryRoot);
    canonicalHome = await realpath(providerHome);
  } catch {
    doctorError(
      "DOCTOR_PROVIDER_HOME_REFUSED",
      exitCodes.CONTAINMENT_REFUSAL,
      "Provider home could not be resolved safely.",
    );
  }
  if (!contained(canonicalRepository, canonicalHome)) {
    doctorError(
      "DOCTOR_PROVIDER_HOME_REFUSED",
      exitCodes.CONTAINMENT_REFUSAL,
      "Provider home resolves outside the repository runtime boundary.",
    );
  }
}

async function declaredDependencies(repositoryRoot: string): Promise<ReadonlySet<string>> {
  try {
    const bytes = await readBoundedRegularFile(
      resolve(repositoryRoot, "package.json"),
      maximumManifestBytes,
      "DOCTOR_PACKAGE_MANIFEST_REFUSED",
      false,
    );
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
    if (!isRecord(value) || !isRecord(value.dependencies)) return new Set();
    return new Set(
      Object.keys(value.dependencies).filter((name) => packageNamePattern.test(name)),
    );
  } catch (error) {
    if (error instanceof UsfError) throw error;
    return new Set();
  }
}

async function installedAdapterVersions(
  repositoryRoot: string,
  packages: readonly string[],
): Promise<Readonly<Record<string, string>>> {
  const declared = await declaredDependencies(repositoryRoot);
  const require = createRequire(resolve(repositoryRoot, "package.json"));
  const canonicalRepository = await realpath(repositoryRoot);
  const versions: Record<string, string> = {};
  for (const packageName of [...new Set(packages)].sort()) {
    if (!packageNamePattern.test(packageName) || !declared.has(packageName)) continue;
    try {
      const manifestPath = await realpath(require.resolve(`${packageName}/package.json`));
      if (!contained(canonicalRepository, manifestPath)) continue;
      const metadata = await lstat(manifestPath);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > maximumManifestBytes) continue;
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
      if (!isRecord(manifest)) continue;
      if (
        manifest.name === packageName &&
        typeof manifest.version === "string" &&
        versionPattern.test(manifest.version)
      ) versions[packageName] = manifest.version;
    } catch {
      // Missing, malformed, undeclared or externally resolved adapters remain uninstalled.
    }
  }
  return Object.freeze(versions);
}

function parseArguments(args: readonly string[]): string | undefined {
  if (args.includes("--provider-health")) {
    doctorError(
      "DOCTOR_PROVIDER_HEALTH_REFUSED",
      exitCodes.INVALID_INPUT,
      "Doctor is local-only; live provider health belongs to usf probe.",
    );
  }
  if (args.length === 0) return undefined;
  if (
    args.length !== 2 ||
    args[0] !== "--env-file" ||
    args[1] === undefined ||
    args[1].length === 0 ||
    args[1].length > maximumExplicitPathLength ||
    args[1].includes("\u0000")
  ) {
    doctorError(
      "DOCTOR_ARGUMENTS_INVALID",
      exitCodes.INVALID_INPUT,
      "Doctor accepts only one explicit --env-file PATH option.",
    );
  }
  return args[1];
}

function validity(
  valid: boolean,
  reasonCode: string,
): Readonly<{ state: "valid" | "invalid"; reasonCode: string | null }> {
  return Object.freeze({ state: valid ? "valid" : "invalid", reasonCode: valid ? null : reasonCode });
}

async function credentialMetadata(
  repositoryRoot: string,
  selectedPath: string | undefined,
  config: ProviderConfig | undefined,
): Promise<CredentialPresenceObservation> {
  const names = config === undefined ? [] : providerCredentialNames(config);
  if (selectedPath === undefined) {
    return Object.freeze({
      source: "not-selected",
      credentials: Object.freeze(names.map((name) => Object.freeze({ name, present: false }))),
      valuesExposed: false,
    });
  }
  if (config === undefined) {
    doctorError(
      "DOCTOR_CONFIG_INVALID_FOR_ENV",
      exitCodes.CURRENTNESS_FAILURE,
      "An explicit credential file requires a valid tracked provider allowlist.",
    );
  }
  try {
    return await inspectCredentialPresence(repositoryRoot, selectedPath, names);
  } catch (error) {
    if (error instanceof CredentialInspectionError) {
      doctorError(
        error.reasonCode === "CREDENTIAL_FILE_TRACKED" ? "DOCTOR_ENV_FILE_TRACKED" : "DOCTOR_GIT_UNAVAILABLE",
        error.reasonCode === "CREDENTIAL_FILE_TRACKED" ? exitCodes.CONTAINMENT_REFUSAL : exitCodes.CURRENTNESS_FAILURE,
        error.reasonCode === "CREDENTIAL_FILE_TRACKED"
          ? "A tracked credential environment file was refused."
          : "Git could not inspect the explicit credential input.",
      );
    }
    if (error instanceof CredentialEnvError) {
      doctorError(
        "DOCTOR_ENV_FILE_REFUSED",
        exitCodes.CONTAINMENT_REFUSAL,
        "The explicit credential environment file was refused.",
        { credentialReasonCode: error.reasonCode },
      );
    }
    throw error;
  }
}

async function catalogueState(repositoryRoot: string): Promise<Readonly<Record<string, unknown>>> {
  try {
    const catalogue = await readLocalCatalogue(repositoryRoot, maximumCatalogueBytes);
    return Object.freeze({
      availability: "available",
      rawDigest: catalogue.snapshot.rawDigest,
      normalizedDigest: catalogue.snapshot.normalizedDigest,
      validity: validity(true, "DOCTOR_CATALOGUE_PAIR_INVALID"),
      freshness: Object.freeze({
        state: "not-observed",
        basis: "no-trusted-acquisition-time",
      }),
    });
  } catch (error) {
    if (error instanceof UsfError && error.code === "MODELS_CATALOGUE_PAIR_MISSING") {
      return Object.freeze({
        availability: "not-observed",
        rawDigest: null,
        normalizedDigest: null,
        validity: validity(false, "DOCTOR_CATALOGUE_PAIR_MISSING"),
        freshness: Object.freeze({
          state: "not-observed",
          basis: "no-trusted-acquisition-time",
        }),
      });
    }
    if (
      error instanceof UsfError &&
      (error.code === "MODELS_CATALOGUE_PAIR_INVALID" ||
        error.code === "MODELS_CATALOGUE_UNREADABLE")
    ) {
      return Object.freeze({
        availability: "available",
        rawDigest: null,
        normalizedDigest: null,
        validity: validity(
          false,
          error.code === "MODELS_CATALOGUE_PAIR_INVALID"
            ? "DOCTOR_CATALOGUE_PAIR_INVALID"
            : "DOCTOR_CATALOGUE_UNREADABLE",
        ),
        freshness: Object.freeze({
          state: "not-observed",
          basis: "no-trusted-acquisition-time",
        }),
      });
    }
    throw error;
  }
}

export const doctorCommandHandler: CommandHandler = async ({ args, repositoryRoot }) => {
  const selectedEnvPath = parseArguments(args);
  await validateProviderHome(repositoryRoot);
  const [providerInput, policyInput, privacyInput] = await Promise.all([
    readTrackedJson(repositoryRoot, trackedInputs.providerConfig),
    readTrackedJson(repositoryRoot, trackedInputs.policy),
    readTrackedJson(repositoryRoot, trackedInputs.privacy),
  ]);

  let providerConfig: ProviderConfig | undefined;
  let providerReasonCode = "DOCTOR_PROVIDER_CONFIG_INVALID";
  if (providerInput.jsonValid) {
    try {
      providerConfig = parseProviderConfig(providerInput.value);
    } catch (error) {
      if (error instanceof ProviderConfigError) providerReasonCode = error.reasonCode;
      else throw error;
    }
  }
  const policyIsValid = policyInput.jsonValid && policyValid(policyInput.value);
  const privacyIsValid = privacyInput.jsonValid && privacyValid(privacyInput.value);
  const adapterPackages = providerConfig?.routes.map((route) => route.adapterPackage) ?? [];
  const installed = await installedAdapterVersions(repositoryRoot, adapterPackages);
  const [credentials, catalogue] = await Promise.all([
    credentialMetadata(repositoryRoot, selectedEnvPath, providerConfig),
    catalogueState(repositoryRoot),
  ]);
  const adapters = Object.freeze(
    [...new Set(adapterPackages)].sort().map((packageName) =>
      Object.freeze({
        package: packageName,
        configuredRoutes: providerConfig!.routes.filter(
          (route) => route.adapterPackage === packageName,
        ).length,
        installedVersion: installed[packageName] ?? null,
      }),
    ),
  );
  const catalogueValid =
    (catalogue.validity as { state: string }).state === "valid";
  const ok = providerConfig !== undefined && policyIsValid && privacyIsValid && catalogueValid;

  return {
    output: Object.freeze({
      schema: "urn:usf:doctor-result:1",
      status: ok ? "ok" : "degraded",
      externalContact: false,
      authorityEffect: "none",
      providerConfig: Object.freeze({
        tracked: true,
        rawDigest: sha256(providerInput.bytes),
        normalizedDigest:
          providerConfig === undefined
            ? null
            : canonicalDigest(providerConfig, { rejectAbsolutePaths: true }),
        validity: validity(providerConfig !== undefined, providerReasonCode),
        configuredRoutes: providerConfig?.routes.length ?? null,
      }),
      policy: Object.freeze({
        tracked: true,
        rawDigest: sha256(policyInput.bytes),
        normalizedDigest:
          policyIsValid
            ? canonicalDigest(policyInput.value, { rejectAbsolutePaths: true })
            : null,
        validity: validity(policyIsValid, "DOCTOR_POLICY_INVALID"),
      }),
      privacy: Object.freeze({
        tracked: true,
        rawDigest: sha256(privacyInput.bytes),
        normalizedDigest:
          privacyIsValid
            ? canonicalDigest(privacyInput.value, { rejectAbsolutePaths: true })
            : null,
        validity: validity(privacyIsValid, "DOCTOR_PRIVACY_INVALID"),
      }),
      catalogue,
      adapters,
      credentials,
      providerHome: Object.freeze({ contained: true, private: true }),
      providerHealth: "not-observed",
      eligibility: "not-evaluated",
      nonclaims: Object.freeze([
        "configured-routes-are-not-live-or-eligible-routes",
        "credential-presence-is-not-authentication-or-entitlement-proof",
        "adapter-installation-is-not-provider-health",
        "catalogue-validity-is-not-current-provider-availability",
        "no-provider-network-semantic-git-write-or-proof-effect",
      ]),
    }),
    exitCode: ok ? exitCodes.SUCCESS : exitCodes.CURRENTNESS_FAILURE,
  };
};
