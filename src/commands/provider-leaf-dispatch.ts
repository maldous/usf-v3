import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { exitCodes, UsfError } from "../core/errors.ts";
import type { CommandHandler, CommandResult } from "./dispatcher.ts";

export type ProviderLeafLoader = (moduleSpecifier: string) => Promise<unknown>;
export type ProviderLeafName = "host" | "receipt";

export interface ProviderLeafAuthorityRequest {
  readonly leaf: ProviderLeafName;
  readonly args: readonly string[];
  readonly repositoryRoot: string;
  readonly proofblockedCode: string;
}

interface ProviderLeafSemanticDependency {
  readonly key: string;
  readonly digest: string;
  readonly kind: string;
}

interface ProviderLeafWorkPacket {
  readonly id: string;
  readonly contract?: string;
  readonly scopedDependencyDigest?: string;
  readonly semanticDependencies?: readonly ProviderLeafSemanticDependency[];
  readonly realisationStage?: {
    readonly stage: string;
    readonly completion: {
      readonly verified: boolean;
      readonly proofResult: unknown | null;
      readonly reasonCodes?: readonly string[];
    };
  };
}

interface ProviderLeafWorkResult {
  readonly status: string;
  readonly items?: readonly ProviderLeafWorkPacket[];
}

export interface ProviderLeafCompletionDependencies {
  readonly validateProfile: (value: string) => string;
  readonly validateManifest: (value: string) => string;
  readonly deriveOwnerWork: (request: {
    readonly repositoryRoot: string;
    readonly manifest: string;
    readonly profile: string;
    readonly work: string;
  }) => ProviderLeafWorkResult;
}

export interface ProviderLeafAuthorization {
  readonly leaf: ProviderLeafName;
  readonly work: string;
  readonly contract: string;
  readonly profile: string;
  readonly manifest: string;
  readonly repositoryRoot: string;
  readonly scopedDependencyDigest: string;
  readonly modulePath: string;
  readonly moduleDigest: string;
}

export type ProviderLeafAuthorizer = (request: ProviderLeafAuthorityRequest) => ProviderLeafAuthorization | Promise<ProviderLeafAuthorization>;

export interface ProviderLeafImportLock {
  <T>(repositoryRoot: string, action: () => Promise<T>): Promise<T>;
}

interface ProviderLeafDefinition {
  readonly work: string;
  readonly contract: string;
  readonly prefix: string;
  readonly label: string;
  readonly modulePath: string;
  readonly moduleSpecifier: string;
  readonly moduleUrl: string;
  readonly handlerExport: string;
  readonly proofblockedCode: string;
  readonly unavailableCode: string;
  readonly proofblockedMessage: string;
  readonly unavailableMessage: string;
}

const definitions = Object.freeze({
  host: Object.freeze({
    work: "urn:usf:work:provider-census",
    contract: "urn:usf:contract:provider-census:1",
    prefix: "PROVIDERS_HOST",
    label: "subscription-host census",
    modulePath: "src/commands/provider-hosts.ts",
    moduleSpecifier: "./provider-hosts.ts",
    moduleUrl: new URL("./provider-hosts.ts", import.meta.url).href,
    handlerExport: "providerHostsCommandHandler",
    proofblockedCode: "PROVIDERS_HOST_PROOFBLOCKED",
    unavailableCode: "PROVIDERS_HOST_UNAVAILABLE",
    proofblockedMessage: "The subscription-host census is registered but its exact current graph-authorized capability is unavailable.",
    unavailableMessage: "The registered subscription-host census implementation does not expose its exact command handler.",
  }),
  receipt: Object.freeze({
    work: "urn:usf:work:provider-account-tier-receipt",
    contract: "urn:usf:contract:provider-account-tier-receipt:1",
    prefix: "PROVIDERS_RECEIPT",
    label: "provider account-tier receipt",
    modulePath: "src/commands/provider-receipts.ts",
    moduleSpecifier: "./provider-receipts.ts",
    moduleUrl: new URL("./provider-receipts.ts", import.meta.url).href,
    handlerExport: "providerReceiptsCommandHandler",
    proofblockedCode: "PROVIDERS_RECEIPT_PROOFBLOCKED",
    unavailableCode: "PROVIDERS_RECEIPT_UNAVAILABLE",
    proofblockedMessage: "The provider receipt interface is registered but its exact current graph-authorized capability is unavailable.",
    unavailableMessage: "The registered provider receipt implementation does not expose its exact command handler.",
  }),
} satisfies Readonly<Record<ProviderLeafName, ProviderLeafDefinition>>);

const implementationRoot = fileURLToPath(new URL("../..", import.meta.url));
const digestPattern = /^sha256:[0-9a-f]{64}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unavailable(definition: ProviderLeafDefinition): never {
  throw new UsfError(definition.unavailableCode, exitCodes.CURRENTNESS_FAILURE, definition.unavailableMessage);
}

function argumentsRefused(definition: ProviderLeafDefinition, suffix: string, message: string): never {
  throw new UsfError(definition.prefix + suffix, exitCodes.INVALID_INPUT, message);
}

function requiredLeafScope(
  args: readonly string[],
  definition: ProviderLeafDefinition,
  dependencies: ProviderLeafCompletionDependencies,
): { readonly profile: string; readonly manifest: string } {
  if (args.length < 1 || (args.length - 1) % 2 !== 0) {
    return argumentsRefused(definition, "_ARGUMENTS_INVALID", "The " + definition.label + " requires one operation followed by explicit option/value pairs.");
  }
  let profile: string | undefined;
  let manifest: string | undefined;
  for (let index = 1; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (option === undefined || !option.startsWith("--") || value === undefined || value.length === 0 || value.startsWith("--")) {
      return argumentsRefused(definition, "_ARGUMENTS_INVALID", "The " + definition.label + " requires explicit non-option values.");
    }
    if (option === "--profile") {
      if (profile !== undefined) return argumentsRefused(definition, "_SCOPE_REQUIRED", "The " + definition.label + " requires exactly one --profile and --manifest pair before import.");
      profile = value;
    }
    if (option === "--manifest") {
      if (manifest !== undefined) return argumentsRefused(definition, "_SCOPE_REQUIRED", "The " + definition.label + " requires exactly one --profile and --manifest pair before import.");
      manifest = value;
    }
  }
  if (profile === undefined || manifest === undefined) {
    return argumentsRefused(definition, "_SCOPE_REQUIRED", "The " + definition.label + " requires exactly one --profile and --manifest pair before import.");
  }
  try {
    return Object.freeze({
      profile: dependencies.validateProfile(profile),
      manifest: dependencies.validateManifest(manifest),
    });
  } catch {
    return argumentsRefused(definition, "_ARGUMENTS_INVALID", "The selected " + definition.label + " profile or manifest is invalid.");
  }
}

function exactRepositoryDependencies(packet: ProviderLeafWorkPacket, definition: ProviderLeafDefinition): readonly ProviderLeafSemanticDependency[] {
  const dependencies = packet.semanticDependencies;
  if (!Array.isArray(dependencies) || dependencies.length === 0) {
    throw new UsfError(definition.prefix + "_DEPENDENCY_REFUSED", exitCodes.CURRENTNESS_FAILURE, "The exact executable dependency closure is unavailable.");
  }
  const seen = new Set<string>();
  const repositoryDependencies: ProviderLeafSemanticDependency[] = [];
  for (const dependency of dependencies) {
    if (!isRecord(dependency) || typeof dependency.key !== "string" || typeof dependency.digest !== "string" || typeof dependency.kind !== "string") {
      throw new UsfError(definition.prefix + "_DEPENDENCY_REFUSED", exitCodes.CURRENTNESS_FAILURE, "The executable dependency closure is malformed.");
    }
    if (dependency.key.startsWith("urn:")) continue;
    const segments = dependency.key.split("/");
    if (dependency.key.startsWith("/") || dependency.key.includes("\\") || segments.includes("") || segments.includes(".") || segments.includes("..") || !digestPattern.test(dependency.digest) || seen.has(dependency.key)) {
      throw new UsfError(definition.prefix + "_DEPENDENCY_REFUSED", exitCodes.CURRENTNESS_FAILURE, "The executable dependency closure is not exact and repository-relative.");
    }
    seen.add(dependency.key);
    repositoryDependencies.push(Object.freeze({ key: dependency.key, digest: dependency.digest, kind: dependency.kind }));
  }
  const moduleDependencies = repositoryDependencies.filter((dependency) => dependency.key === definition.modulePath);
  if (moduleDependencies.length !== 1) {
    throw new UsfError(definition.prefix + "_DEPENDENCY_REFUSED", exitCodes.CURRENTNESS_FAILURE, "The exact leaf module is not bound once by the executable dependency closure.");
  }
  return Object.freeze(repositoryDependencies);
}

export function createProviderLeafCompletionAuthorizer(dependencies: ProviderLeafCompletionDependencies): ProviderLeafAuthorizer {
  return (request) => {
    const definition = definitions[request.leaf];
    const scope = requiredLeafScope(request.args, definition, dependencies);
    let result: ProviderLeafWorkResult;
    try {
      result = dependencies.deriveOwnerWork({
        repositoryRoot: request.repositoryRoot,
        manifest: scope.manifest,
        profile: scope.profile,
        work: definition.work,
      });
    } catch (error) {
      const reasonCode = error instanceof UsfError ? error.code : error instanceof Error ? error.message : "GRAPH_LOAD_FAILED";
      throw new UsfError(definition.prefix + "_SCOPE_REFUSED", exitCodes.CURRENTNESS_FAILURE, "The exact current " + definition.label + " authority could not be derived.", { reasonCode });
    }
    const packet = result.items?.[0];
    if (result.status !== "ok" || result.items?.length !== 1 || packet?.id !== definition.work || packet.contract !== definition.contract) {
      throw new UsfError(definition.prefix + "_SCOPE_REFUSED", exitCodes.CURRENTNESS_FAILURE, "The selected profile does not resolve the exact " + definition.label + " owner.");
    }
    const stage = packet.realisationStage;
    if (stage?.stage !== "verified-complete" || stage.completion?.verified !== true || stage.completion.proofResult === null || stage.completion.proofResult === undefined) {
      throw new UsfError(request.proofblockedCode, exitCodes.DOMAIN_FAILURE, "The " + definition.label + " remains proofblocked until its exact current file-based work completion is independently verified and published.", {
        ownerWork: definition.work,
        capabilityStage: stage?.stage ?? "unknown",
        completionReasonCodes: stage?.completion?.reasonCodes ?? [],
      });
    }
    if (typeof packet.scopedDependencyDigest !== "string" || !digestPattern.test(packet.scopedDependencyDigest)) {
      throw new UsfError(definition.prefix + "_DEPENDENCY_REFUSED", exitCodes.CURRENTNESS_FAILURE, "The current scoped dependency identity is unavailable.");
    }
    const repositoryDependencies = exactRepositoryDependencies(packet, definition);
    const moduleDependency = repositoryDependencies.find((dependency) => dependency.key === definition.modulePath)!;
    return Object.freeze({
      leaf: request.leaf,
      work: definition.work,
      contract: definition.contract,
      profile: scope.profile,
      manifest: scope.manifest,
      repositoryRoot: request.repositoryRoot,
      scopedDependencyDigest: packet.scopedDependencyDigest,
      modulePath: definition.modulePath,
      moduleDigest: moduleDependency.digest,
    });
  };
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if (!isRecord(error) || error.code !== "EEXIST") throw error;
  }
  const metadata = await lstat(path);
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || uid === undefined || metadata.uid !== uid || (metadata.mode & 0o077) !== 0 || await realpath(path) !== path) {
    throw new UsfError("PROVIDERS_LEAF_LOCK_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The repository-local lock directory is not owner-private and exact.");
  }
}

export const withSharedProviderLeafImportLock: ProviderLeafImportLock = async (repositoryRoot, action) => {
  const usfDirectory = resolve(repositoryRoot, ".usf");
  const lockDirectory = resolve(usfDirectory, "locks");
  await ensurePrivateDirectory(usfDirectory);
  await ensurePrivateDirectory(lockDirectory);
  const lockPath = resolve(lockDirectory, "primary-mutation.lock");
  const trustedFlock = await lstat("/usr/bin/flock").catch(() => undefined);
  if (trustedFlock === undefined || !trustedFlock.isFile() || trustedFlock.isSymbolicLink() || trustedFlock.uid !== 0 || (trustedFlock.mode & 0o022) !== 0 || (trustedFlock.mode & 0o111) === 0) {
    throw new UsfError("PROVIDERS_LEAF_LOCK_UNAVAILABLE", exitCodes.EXTERNAL_UNAVAILABLE, "The trusted util-linux flock boundary is unavailable.");
  }
  let created = false;
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(lockPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_RDWR | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK, 0o600);
    created = true;
  } catch (error) {
    if (!isRecord(error) || error.code !== "EEXIST") throw new UsfError("PROVIDERS_LEAF_LOCK_UNAVAILABLE", exitCodes.CURRENTNESS_FAILURE, "The primary mutation lock could not be opened.");
    handle = await open(lockPath, fsConstants.O_RDWR | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK)
      .catch(() => { throw new UsfError("PROVIDERS_LEAF_LOCK_UNAVAILABLE", exitCodes.CURRENTNESS_FAILURE, "The primary mutation lock could not be opened."); });
  }
  try {
    if (created) await handle.chmod(0o600);
    const opened = await handle.stat();
    const named = await lstat(lockPath);
    const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
    if (!opened.isFile() || named.isSymbolicLink() || !named.isFile() || uid === undefined || opened.uid !== uid || opened.nlink !== 1 || named.nlink !== 1 || (opened.mode & 0o777) !== 0o600 || (named.mode & 0o777) !== 0o600 || opened.dev !== named.dev || opened.ino !== named.ino || await realpath(lockPath) !== lockPath) {
      throw new UsfError("PROVIDERS_LEAF_LOCK_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The persistent primary mutation lock identity is unsafe.");
    }
    const code = await new Promise<number>((finish) => {
      let settled = false;
      const done = (value: number): void => {
        if (settled) return;
        settled = true;
        finish(value);
      };
      const child = spawn("/usr/bin/flock", ["--shared", "--nonblock", "--conflict-exit-code", "75", "3"], { stdio: ["ignore", "ignore", "ignore", handle.fd] });
      child.once("error", () => done(127));
      child.once("exit", (value) => done(value ?? 127));
    });
    if (code === 75) throw new UsfError("PROVIDERS_LEAF_LOCK_BUSY", exitCodes.CURRENTNESS_FAILURE, "A primary mutation is in progress; leaf currentness was not observed.");
    if (code !== 0) throw new UsfError("PROVIDERS_LEAF_LOCK_UNAVAILABLE", exitCodes.EXTERNAL_UNAVAILABLE, "The shared primary mutation lock could not be acquired.");
    const held = await handle.stat();
    if (held.dev !== opened.dev || held.ino !== opened.ino || held.nlink !== 1 || (held.mode & 0o777) !== 0o600) {
      throw new UsfError("PROVIDERS_LEAF_LOCK_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The primary mutation lock changed after acquisition.");
    }
    return await action();
  } finally {
    await handle.close();
  }
};

async function requireImplementationRoot(repositoryRoot: string, definition: ProviderLeafDefinition): Promise<void> {
  try {
    if (await realpath(repositoryRoot) !== await realpath(implementationRoot)) {
      throw new UsfError(definition.prefix + "_ROOT_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "Leaf authority and implementation must come from the same repository root.");
    }
  } catch (error) {
    if (error instanceof UsfError) throw error;
    throw new UsfError(definition.prefix + "_ROOT_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The exact leaf implementation root could not be authenticated.");
  }
}

export function createProviderLeafDispatcher(
  dependencies: {
    readonly authorize: ProviderLeafAuthorizer;
    readonly load?: ProviderLeafLoader;
    readonly withImportLock?: ProviderLeafImportLock;
  },
): (args: readonly string[], repositoryRoot: string) => Promise<CommandResult | null> {
  const load = dependencies.load ?? ((moduleSpecifier: string) => import(moduleSpecifier));
  const withImportLock = dependencies.withImportLock ?? withSharedProviderLeafImportLock;
  return async (args, repositoryRoot) => {
    const leaf = args[0];
    if (leaf !== "host" && leaf !== "receipt") return null;
    const definition = definitions[leaf];
    const leafArgs = args.slice(1);
    await requireImplementationRoot(repositoryRoot, definition);
    const handler = await withImportLock(repositoryRoot, async () => {
      const authorization = await dependencies.authorize(Object.freeze({
        leaf,
        args: leafArgs,
        repositoryRoot,
        proofblockedCode: definition.proofblockedCode,
      }));
      if (authorization.leaf !== leaf || authorization.work !== definition.work || authorization.contract !== definition.contract || authorization.repositoryRoot !== repositoryRoot || authorization.modulePath !== definition.modulePath || !digestPattern.test(authorization.moduleDigest)) {
        throw new UsfError(definition.prefix + "_DEPENDENCY_REFUSED", exitCodes.CURRENTNESS_FAILURE, "The leaf authorization ticket does not bind the exact module and owner.");
      }
      let loaded: Record<string, unknown>;
      try {
        const candidate = await load(definition.moduleSpecifier);
        if (!isRecord(candidate)) return unavailable(definition);
        loaded = candidate;
      } catch (error) {
        const code = isRecord(error) && typeof error.code === "string" ? error.code : undefined;
        const missingUrl = isRecord(error) && typeof error.url === "string" ? error.url : undefined;
        if (code === "ERR_MODULE_NOT_FOUND" && missingUrl === definition.moduleUrl) {
          throw new UsfError(definition.proofblockedCode, exitCodes.DOMAIN_FAILURE, definition.proofblockedMessage);
        }
        throw error;
      }
      const selected = loaded[definition.handlerExport];
      if (typeof selected !== "function") return unavailable(definition);
      return selected as CommandHandler;
    });
    return handler({ command: "providers", args: leafArgs, repositoryRoot });
  };
}
