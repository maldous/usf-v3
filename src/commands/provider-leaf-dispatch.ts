import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, constants as fsConstants, fstatSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import type { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";

import { canonicalDigest, sha256 } from "../core/canonical.ts";
import { exitCodes, UsfError } from "../core/errors.ts";
import type { RealisationBasis } from "../realisation/basis.ts";
import type { CommandHandler, CommandResult } from "./dispatcher.ts";

export type ProviderLeafLoader = (moduleSpecifier: string) => Promise<unknown>;
export type ProviderLeafName = "host" | "receipt";

export interface ProviderLeafAuthorityRequest {
  readonly leaf: ProviderLeafName;
  readonly args: readonly string[];
  readonly repositoryRoot: string;
  readonly proofblockedCode: string;
}

export interface RepositoryLeafSemanticDependency {
  readonly key: string;
  readonly digest: string;
  readonly kind: string;
}

export interface RepositoryLeafRequirementField {
  readonly predicate: string;
  readonly value: string;
  readonly valueKind: "iri" | "literal";
}

export interface RepositoryLeafRequirement {
  readonly id: string;
  readonly types: readonly string[];
  readonly fields: readonly RepositoryLeafRequirementField[];
}

export interface RepositoryLeafWorkPacket {
  readonly id: string;
  readonly contract?: string;
  readonly scopedDependencyDigest?: string;
  readonly realisationBasis?: {
    readonly basisDigest?: string;
  };
  readonly semanticDependencies?: readonly RepositoryLeafSemanticDependency[];
  readonly requirements?: readonly RepositoryLeafRequirement[];
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
  readonly items?: readonly RepositoryLeafWorkPacket[];
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
  readonly basisDigest: string;
  readonly scopedDependencyDigest: string;
  readonly modulePath: string;
  readonly moduleDigest: string;
  readonly repositoryDependencies: readonly ProviderLeafRepositoryDependency[];
  readonly repositoryClosureDigest: string;
}

export type ProviderLeafAuthorizer = (request: ProviderLeafAuthorityRequest) => ProviderLeafAuthorization | Promise<ProviderLeafAuthorization>;

export type ProviderLeafRepositoryDependencyRole = "file" | "policy" | "schema" | "tool";

export interface ProviderLeafRepositoryDependency {
  readonly path: string;
  readonly digest: string;
  readonly roles: readonly ProviderLeafRepositoryDependencyRole[];
}

export type RepositoryLeafDependency = ProviderLeafRepositoryDependency;

export type ProviderLeafAuthenticator = (
  authorization: ProviderLeafAuthorization,
  dependencies: readonly ProviderLeafRepositoryDependency[],
) => Promise<void>;

export interface ProviderLeafImportLock {
  <T>(repositoryRoot: string, action: () => Promise<T>): Promise<T>;
}

interface ProviderLeafDefinition {
  readonly work: string;
  readonly contract: string;
  readonly prefix: string;
  readonly label: string;
  readonly modulePath: string;
  readonly handlerExport: string;
  readonly proofblockedCode: string;
  readonly unavailableCode: string;
  readonly proofblockedMessage: string;
  readonly unavailableMessage: string;
}

interface RepositoryLeafClosureBoundary {
  readonly work: string;
  readonly modulePath: string;
  readonly prefix: string;
}

const definitions = Object.freeze({
  host: Object.freeze({
    work: "urn:usf:work:provider-census",
    contract: "urn:usf:contract:provider-census:1",
    prefix: "PROVIDERS_HOST",
    label: "subscription-host census",
    modulePath: "src/commands/provider-hosts.ts",
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
    handlerExport: "providerReceiptsCommandHandler",
    proofblockedCode: "PROVIDERS_RECEIPT_PROOFBLOCKED",
    unavailableCode: "PROVIDERS_RECEIPT_UNAVAILABLE",
    proofblockedMessage: "The provider receipt interface is registered but its exact current graph-authorized capability is unavailable.",
    unavailableMessage: "The registered provider receipt implementation does not expose its exact command handler.",
  }),
} satisfies Readonly<Record<ProviderLeafName, ProviderLeafDefinition>>);

const implementationRoot = fileURLToPath(new URL("../..", import.meta.url));
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const productionLeafRuntimeClosureType = "urn:usf:type:ProductionLeafRuntimeClosure";
const ownerWorkPredicate = "urn:usf:predicate:ownerWork";
const entryModulePathPredicate = "urn:usf:predicate:entryModulePath";
const closureMemberCountPredicate = "urn:usf:predicate:closureMemberCount";
const runtimePathPredicate = "urn:usf:predicate:runtimePath";
const repositoryRoles = Object.freeze(["file", "policy", "schema", "tool"] as const);
const repositoryRoleSet = new Set<string>(repositoryRoles);
const childControlMaximumBytes = 65_536;
const childOutputMaximumBytes = 4_194_304;
const childAdmissionTimeoutMilliseconds = 30_000;
const childTerminationGraceMilliseconds = 5_000;
const launcherLockFileDescriptorEnvironment = "USF_DYNAMIC_LEAF_LOCK_FD";
const launcherLeafEnvironment = "USF_DYNAMIC_LEAF";
const childEntryArgument = "--usf-dynamic-leaf-child";

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

function repositoryDependencyRefused(definition: RepositoryLeafClosureBoundary, message: string): never {
  throw new UsfError(definition.prefix + "_DEPENDENCY_REFUSED", exitCodes.CURRENTNESS_FAILURE, message);
}

function isRepositoryPath(value: string): boolean {
  if (value.length === 0 || value.startsWith("/") || value.includes("\\") || value.includes("\0")) return false;
  const segments = value.split("/");
  return !segments.includes("") && !segments.includes(".") && !segments.includes("..");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactRequirementFields(
  requirement: RepositoryLeafRequirement,
  predicate: string,
  valueKind: "iri" | "literal",
  definition: RepositoryLeafClosureBoundary,
): readonly string[] {
  const fields = requirement.fields.filter((field) => field.predicate === predicate);
  if (fields.some((field) => field.valueKind !== valueKind || typeof field.value !== "string")) {
    return repositoryDependencyRefused(definition, "The production leaf runtime closure has a malformed field.");
  }
  return Object.freeze(fields.map((field) => field.value));
}

function exactProductionRuntimePaths(packet: RepositoryLeafWorkPacket, definition: RepositoryLeafClosureBoundary): readonly string[] {
  if (!Array.isArray(packet.requirements)) {
    return repositoryDependencyRefused(definition, "The graph-projected production leaf runtime closure is unavailable.");
  }
  const closures = packet.requirements.filter((requirement) => isRecord(requirement)
    && Array.isArray(requirement.types)
    && requirement.types.includes(productionLeafRuntimeClosureType));
  if (closures.length !== 1) {
    return repositoryDependencyRefused(definition, "Exactly one graph-projected production leaf runtime closure is required.");
  }
  const closure = closures[0]!;
  if (typeof closure.id !== "string" || !Array.isArray(closure.fields) || closure.fields.some((field: unknown) => !isRecord(field) || typeof field.predicate !== "string" || typeof field.value !== "string" || (field.valueKind !== "iri" && field.valueKind !== "literal"))) {
    return repositoryDependencyRefused(definition, "The graph-projected production leaf runtime closure is malformed.");
  }
  const owners = exactRequirementFields(closure, ownerWorkPredicate, "iri", definition);
  const entries = exactRequirementFields(closure, entryModulePathPredicate, "literal", definition);
  const memberCounts = exactRequirementFields(closure, closureMemberCountPredicate, "literal", definition);
  const declaredPaths = exactRequirementFields(closure, runtimePathPredicate, "literal", definition);
  if (owners.length !== 1 || owners[0] !== definition.work || entries.length !== 1 || entries[0] !== definition.modulePath || memberCounts.length !== 1 || !/^[1-9][0-9]*$/u.test(memberCounts[0]!) || Number(memberCounts[0]) !== declaredPaths.length || declaredPaths.length === 0) {
    return repositoryDependencyRefused(definition, "The production leaf runtime closure does not bind the exact leaf owner, entry module and member count.");
  }
  if (declaredPaths.some((path) => !isRepositoryPath(path)) || new Set(declaredPaths).size !== declaredPaths.length) {
    return repositoryDependencyRefused(definition, "The production leaf runtime paths are not exact and unique.");
  }
  const runtimePaths = Object.freeze([...declaredPaths].sort(compareText));
  if (!runtimePaths.includes(definition.modulePath)) {
    return repositoryDependencyRefused(definition, "The production leaf entry module is absent from its declared runtime closure.");
  }
  return runtimePaths;
}

function exactRepositoryDependencies(packet: RepositoryLeafWorkPacket, definition: RepositoryLeafClosureBoundary): readonly ProviderLeafRepositoryDependency[] {
  const dependencies = packet.semanticDependencies;
  if (!Array.isArray(dependencies) || dependencies.length === 0) {
    return repositoryDependencyRefused(definition, "The exact executable dependency closure is unavailable.");
  }
  const runtimePaths = exactProductionRuntimePaths(packet, definition);
  const runtimePathSet = new Set(runtimePaths);
  const byPath = new Map<string, { digest: string; roles: Set<ProviderLeafRepositoryDependencyRole> }>();
  for (const dependency of dependencies) {
    if (!isRecord(dependency) || typeof dependency.key !== "string" || typeof dependency.digest !== "string" || typeof dependency.kind !== "string") {
      return repositoryDependencyRefused(definition, "The executable dependency closure is malformed.");
    }
    if (dependency.key.startsWith("urn:")) continue;
    if (!runtimePathSet.has(dependency.key)) continue;
    if (!isRepositoryPath(dependency.key) || !digestPattern.test(dependency.digest) || !repositoryRoleSet.has(dependency.kind)) {
      return repositoryDependencyRefused(definition, "The production leaf runtime dependency closure is not exact, repository-relative and role-bounded.");
    }
    const role = dependency.kind as ProviderLeafRepositoryDependencyRole;
    const current = byPath.get(dependency.key);
    if (current !== undefined) {
      if (current.digest !== dependency.digest) {
        return repositoryDependencyRefused(definition, "One repository dependency path has conflicting digests.");
      }
      current.roles.add(role);
      continue;
    }
    byPath.set(dependency.key, { digest: dependency.digest, roles: new Set([role]) });
  }
  const repositoryDependencies = [...byPath.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([path, dependency]) => Object.freeze({
      path,
      digest: dependency.digest,
      roles: Object.freeze([...dependency.roles].sort(compareText)),
    }));
  if (repositoryDependencies.length !== runtimePaths.length || repositoryDependencies.some((dependency, index) => dependency.path !== runtimePaths[index])) {
    return repositoryDependencyRefused(definition, "The graph-declared production leaf runtime closure is not completely bound by repository dependency rows.");
  }
  return Object.freeze(repositoryDependencies);
}

export function deriveRepositoryLeafDependencies(
  packet: RepositoryLeafWorkPacket,
  expectation: {
    readonly ownerWork: string;
    readonly entryModulePath: string;
    readonly reasonCode: string;
  },
): readonly RepositoryLeafDependency[] {
  if (!/^[A-Z][A-Z0-9_]*$/u.test(expectation.reasonCode)) {
    throw new UsfError("REPOSITORY_LEAF_REASON_CODE_INVALID", exitCodes.INVALID_INPUT, "A stable repository-leaf refusal code is required.");
  }
  return exactRepositoryDependencies(packet, {
    work: expectation.ownerWork,
    modulePath: expectation.entryModulePath,
    prefix: expectation.reasonCode.replace(/_DEPENDENCY_REFUSED$/u, ""),
  });
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
    const basisDigest = packet.realisationBasis?.basisDigest;
    if (typeof basisDigest !== "string" || !digestPattern.test(basisDigest)) {
      throw new UsfError(definition.prefix + "_BASIS_REFUSED", exitCodes.CURRENTNESS_FAILURE, "The current file-based realisation basis identity is unavailable.");
    }
    const repositoryDependencies = exactRepositoryDependencies(packet, definition);
    const moduleDependency = repositoryDependencies.find((dependency) => dependency.path === definition.modulePath)!;
    return Object.freeze({
      leaf: request.leaf,
      work: definition.work,
      contract: definition.contract,
      profile: scope.profile,
      manifest: scope.manifest,
      repositoryRoot: request.repositoryRoot,
      basisDigest,
      scopedDependencyDigest: packet.scopedDependencyDigest,
      modulePath: definition.modulePath,
      moduleDigest: moduleDependency.digest,
      repositoryDependencies,
      repositoryClosureDigest: canonicalDigest(repositoryDependencies),
    });
  };
}

async function authorizeCurrentProviderLeaf(request: ProviderLeafAuthorityRequest): Promise<ProviderLeafAuthorization> {
  const [{ validateRepositoryManifest, validateVersionedProfile }, { loadSemanticGraph }, workModule, basisModule] = await Promise.all([
    import("../continuous/lifecycle.ts"),
    import("../graph/index.ts"),
    import("../graph/work.ts"),
    import("../realisation/basis.ts"),
  ]);
  let selectedPacket: RepositoryLeafWorkPacket | undefined;
  const authorize = createProviderLeafCompletionAuthorizer({
    validateProfile: validateVersionedProfile,
    validateManifest: validateRepositoryManifest,
    deriveOwnerWork: ({ repositoryRoot, manifest, profile, work }) => {
      const result = workModule.deriveWork(loadSemanticGraph(repositoryRoot, manifest), {
        profile,
        selector: work,
        maxItems: 1,
      });
      selectedPacket = result.items?.[0] as RepositoryLeafWorkPacket | undefined;
      return result;
    },
  });
  const authorization = await authorize(request);
  const projectedBasis = selectedPacket?.realisationBasis;
  try {
    const assertRealisationBasis: (value: unknown) => asserts value is RealisationBasis = basisModule.assertRealisationBasis;
    assertRealisationBasis(projectedBasis);
    basisModule.assertBasisMatchesPacket(projectedBasis, selectedPacket as import("../graph/work.ts").WorkPacket);
    const currentBasis = await workModule.deriveCurrentRealisationBasis(request.repositoryRoot, projectedBasis);
    basisModule.assertBasisMatchesPacket(currentBasis, selectedPacket as import("../graph/work.ts").WorkPacket);
    basisModule.assertSameBasis(projectedBasis, currentBasis);
    if (currentBasis.basisDigest !== authorization.basisDigest) throw new Error("PROVIDER_LEAF_BASIS_DIGEST_MISMATCH");
  } catch (error) {
    const definition = definitions[request.leaf];
    const reasonCode = error instanceof Error ? error.message : "BASIS_CURRENTNESS_FAILED";
    throw new UsfError(definition.prefix + "_BASIS_REFUSED", exitCodes.CURRENTNESS_FAILURE, "The provider leaf realisation basis is not exact and current.", { reasonCode });
  }
  return authorization;
}

export interface FreshLeafChildEntryAuthorityRequest {
  readonly repositoryRoot: string;
  readonly profile: string;
  readonly manifest: string;
  readonly featureWork: string;
  readonly path: FreshLeafChildEntryAuthority["path"];
}

export type FreshLeafChildEntryAuthorizer = (
  request: FreshLeafChildEntryAuthorityRequest,
) => FreshLeafChildEntryAuthority | Promise<FreshLeafChildEntryAuthority>;

function exactDependencyForPath(
  packet: RepositoryLeafWorkPacket,
  path: string,
  reasonCode: string,
): RepositoryLeafDependency {
  const rows = packet.semanticDependencies?.filter((row) => row.key === path) ?? [];
  if (rows.length === 0) {
    throw new UsfError(reasonCode, exitCodes.CURRENTNESS_FAILURE, "The selected downstream packet does not bind its operator-owned child entry.");
  }
  let digest: string | undefined;
  const roles = new Set<ProviderLeafRepositoryDependencyRole>();
  for (const row of rows) {
    if (!digestPattern.test(row.digest) || !repositoryRoleSet.has(row.kind)) {
      throw new UsfError(reasonCode, exitCodes.CURRENTNESS_FAILURE, "The selected child-entry dependency is malformed or role-unbounded.");
    }
    if (digest !== undefined && digest !== row.digest) {
      throw new UsfError(reasonCode, exitCodes.CURRENTNESS_FAILURE, "The selected child-entry dependency has conflicting digests.");
    }
    digest = row.digest;
    roles.add(row.kind as ProviderLeafRepositoryDependencyRole);
  }
  return Object.freeze({ path, digest: digest!, roles: Object.freeze([...roles].sort(compareText)) });
}

export const authorizeCurrentFreshLeafChildEntry: FreshLeafChildEntryAuthorizer = async (request) => {
  const [{ validateRepositoryManifest, validateVersionedProfile }, { loadSemanticGraph }, workModule, basisModule] = await Promise.all([
    import("../continuous/lifecycle.ts"),
    import("../graph/index.ts"),
    import("../graph/work.ts"),
    import("../realisation/basis.ts"),
  ]);
  let profile: string;
  let manifest: string;
  try {
    profile = validateVersionedProfile(request.profile);
    manifest = validateRepositoryManifest(request.manifest);
  } catch {
    throw new UsfError("DYNAMIC_LEAF_CHILD_ENTRY_SCOPE_REFUSED", exitCodes.INVALID_INPUT, "The child-entry authority requires one exact versioned profile and repository manifest.");
  }
  const graph = loadSemanticGraph(request.repositoryRoot, manifest);
  const feature = workModule.deriveWork(graph, { profile, selector: request.featureWork, maxItems: 1 });
  const featurePacket = feature.items?.[0] as RepositoryLeafWorkPacket | undefined;
  if (feature.status !== "ok" || feature.items?.length !== 1 || featurePacket?.id !== request.featureWork) {
    throw new UsfError("DYNAMIC_LEAF_CHILD_ENTRY_SCOPE_REFUSED", exitCodes.CURRENTNESS_FAILURE, "The selected feature packet cannot bind the operator child entry.");
  }
  const dependency = exactDependencyForPath(featurePacket, request.path, "DYNAMIC_LEAF_CHILD_ENTRY_DEPENDENCY_REFUSED");
  const operator = workModule.deriveWork(graph, { profile, selector: "urn:usf:work:operator-observability", maxItems: 1 });
  const operatorPacket = operator.items?.[0] as RepositoryLeafWorkPacket | undefined;
  if (operator.status !== "ok"
    || operator.items?.length !== 1
    || operatorPacket?.id !== "urn:usf:work:operator-observability"
    || operatorPacket.contract !== "urn:usf:contract:operator-observability:1") {
    throw new UsfError("DYNAMIC_LEAF_CHILD_ENTRY_SCOPE_REFUSED", exitCodes.CURRENTNESS_FAILURE, "The selected profile does not resolve the exact operator child-entry owner.");
  }
  const stage = operatorPacket.realisationStage;
  if (stage?.stage !== "verified-complete" || stage.completion.verified !== true || stage.completion.proofResult == null) {
    throw new UsfError("DYNAMIC_LEAF_CHILD_ENTRY_PROOFBLOCKED", exitCodes.DOMAIN_FAILURE, "The operator child entry remains unavailable until its exact current completion is published.", {
      capabilityStage: stage?.stage ?? "unknown",
      completionReasonCodes: stage?.completion.reasonCodes ?? [],
    });
  }
  if (typeof operatorPacket.scopedDependencyDigest !== "string" || !digestPattern.test(operatorPacket.scopedDependencyDigest)) {
    throw new UsfError("DYNAMIC_LEAF_CHILD_ENTRY_DEPENDENCY_REFUSED", exitCodes.CURRENTNESS_FAILURE, "The operator child-entry scoped dependency identity is unavailable.");
  }
  const projectedBasis = operatorPacket.realisationBasis;
  let currentBasis: RealisationBasis;
  try {
    const assertRealisationBasis: (value: unknown) => asserts value is RealisationBasis = basisModule.assertRealisationBasis;
    assertRealisationBasis(projectedBasis);
    basisModule.assertBasisMatchesPacket(projectedBasis, operatorPacket as import("../graph/work.ts").WorkPacket);
    currentBasis = await workModule.deriveCurrentRealisationBasis(request.repositoryRoot, projectedBasis);
    basisModule.assertBasisMatchesPacket(currentBasis, operatorPacket as import("../graph/work.ts").WorkPacket);
    basisModule.assertSameBasis(projectedBasis, currentBasis);
  } catch (error) {
    const reasonCode = error instanceof Error ? error.message : "BASIS_CURRENTNESS_FAILED";
    throw new UsfError("DYNAMIC_LEAF_CHILD_ENTRY_BASIS_REFUSED", exitCodes.CURRENTNESS_FAILURE, "The operator child-entry basis is not exact and current.", { reasonCode });
  }
  return Object.freeze({
    work: "urn:usf:work:operator-observability",
    contract: "urn:usf:contract:operator-observability:1",
    basisDigest: currentBasis.basisDigest,
    scopedDependencyDigest: operatorPacket.scopedDependencyDigest,
    path: request.path,
    digest: dependency.digest,
    dependency,
  });
};

export async function authenticateFreshLeafChildEntry(
  repositoryRoot: string,
  authority: FreshLeafChildEntryAuthority,
  reasonCode = "DYNAMIC_LEAF_CHILD_ENTRY_DEPENDENCY_REFUSED",
): Promise<void> {
  if (authority.dependency.path !== authority.path || authority.dependency.digest !== authority.digest) {
    throw new UsfError(reasonCode, exitCodes.CURRENTNESS_FAILURE, "The operator child-entry authority is internally inconsistent.");
  }
  await authenticateRepositoryLeafDependencies(repositoryRoot, Object.freeze([authority.dependency]), reasonCode);
}

function exactTicketDependencies(
  authorization: ProviderLeafAuthorization,
  definition: RepositoryLeafClosureBoundary,
): readonly ProviderLeafRepositoryDependency[] {
  if (!Array.isArray(authorization.repositoryDependencies) || authorization.repositoryDependencies.length === 0) {
    return repositoryDependencyRefused(definition, "The leaf authorization ticket has no canonical repository closure.");
  }
  let previousPath: string | undefined;
  let moduleCount = 0;
  for (const dependency of authorization.repositoryDependencies) {
    if (!isRecord(dependency) || typeof dependency.path !== "string" || typeof dependency.digest !== "string" || !Array.isArray(dependency.roles) || dependency.roles.length === 0 || !isRepositoryPath(dependency.path) || !digestPattern.test(dependency.digest)) {
      return repositoryDependencyRefused(definition, "The leaf authorization ticket repository closure is malformed.");
    }
    if (previousPath !== undefined && compareText(previousPath, dependency.path) >= 0) {
      return repositoryDependencyRefused(definition, "The leaf authorization ticket repository closure is not uniquely path-sorted.");
    }
    let previousRole: string | undefined;
    for (const role of dependency.roles) {
      if (typeof role !== "string" || !repositoryRoleSet.has(role) || (previousRole !== undefined && compareText(previousRole, role) >= 0)) {
        return repositoryDependencyRefused(definition, "The leaf authorization ticket repository roles are not exact and canonical.");
      }
      previousRole = role;
    }
    if (dependency.path === definition.modulePath) {
      moduleCount += 1;
      if (dependency.digest !== authorization.moduleDigest) {
        return repositoryDependencyRefused(definition, "The leaf authorization ticket module digest is inconsistent with its repository closure.");
      }
    }
    previousPath = dependency.path;
  }
  if (moduleCount !== 1
    || typeof authorization.basisDigest !== "string"
    || !digestPattern.test(authorization.basisDigest)
    || typeof authorization.repositoryClosureDigest !== "string"
    || !digestPattern.test(authorization.repositoryClosureDigest)
    || canonicalDigest(authorization.repositoryDependencies) !== authorization.repositoryClosureDigest) {
    return repositoryDependencyRefused(definition, "The leaf authorization ticket does not bind one exact canonical repository closure.");
  }
  return authorization.repositoryDependencies;
}

interface StableFileStat {
  readonly dev: number;
  readonly ino: number;
  readonly mode: number;
  readonly nlink: number;
  readonly size: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
}

function stableFileIdentity(left: StableFileStat, right: StableFileStat): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

export async function authenticateRepositoryLeafDependencies(
  selectedRoot: string,
  dependencies: readonly RepositoryLeafDependency[],
  reasonCode: string,
): Promise<void> {
  const refused = (message: string): never => {
    throw new UsfError(reasonCode, exitCodes.CURRENTNESS_FAILURE, message);
  };
  let repositoryRoot: string;
  try {
    repositoryRoot = await realpath(selectedRoot);
  } catch {
    return refused("The repository dependency root could not be authenticated.");
  }
  if (typeof fsConstants.O_NOFOLLOW !== "number" || fsConstants.O_NOFOLLOW === 0) {
    return refused("The mandatory no-follow repository dependency boundary is unavailable.");
  }
  for (const dependency of dependencies) {
    const dependencyPath = resolve(repositoryRoot, dependency.path);
    if (dependencyPath === repositoryRoot || !dependencyPath.startsWith(repositoryRoot + "/")) {
      return refused("A repository dependency is outside the selected root.");
    }
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      const namedBefore = await lstat(dependencyPath);
      if (!namedBefore.isFile() || namedBefore.isSymbolicLink() || await realpath(dependencyPath) !== dependencyPath) {
        return refused("A repository dependency is not an exact regular non-symlink file.");
      }
      handle = await open(dependencyPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK);
      const openedBefore = await handle.stat();
      if (!openedBefore.isFile() || openedBefore.dev !== namedBefore.dev || openedBefore.ino !== namedBefore.ino) {
        return refused("A repository dependency changed while it was opened.");
      }
      const bytes = await handle.readFile();
      const openedAfter = await handle.stat();
      const namedAfter = await lstat(dependencyPath);
      if (!namedAfter.isFile() || namedAfter.isSymbolicLink() || await realpath(dependencyPath) !== dependencyPath || bytes.byteLength !== openedBefore.size || !stableFileIdentity(openedBefore, openedAfter) || openedAfter.dev !== namedAfter.dev || openedAfter.ino !== namedAfter.ino || !stableFileIdentity(namedBefore, namedAfter)) {
        return refused("A repository dependency changed during byte authentication.");
      }
      if (sha256(bytes) !== dependency.digest) {
        return refused("A repository dependency does not match its authorized SHA-256 bytes.");
      }
    } catch (error) {
      if (error instanceof UsfError) throw error;
      return refused("A repository dependency could not be authenticated.");
    } finally {
      await handle?.close();
    }
  }
}

export const authenticateProviderLeafRepositoryDependencies: ProviderLeafAuthenticator = async (authorization, dependencies) => {
  const definition = definitions[authorization.leaf];
  await authenticateRepositoryLeafDependencies(
    authorization.repositoryRoot,
    dependencies,
    definition.prefix + "_DEPENDENCY_REFUSED",
  );
};

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

export async function acquireSharedPrimaryMutationLock(repositoryRoot: string): Promise<FreshLeafLauncherLock> {
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
    let released = false;
    const validate = async (): Promise<void> => {
      if (released) throw new UsfError("PROVIDERS_LEAF_LOCK_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The primary mutation lock was released early.");
      const held = await handle.stat();
      const current = await lstat(lockPath);
      if (!current.isFile() || current.isSymbolicLink() || held.dev !== opened.dev || held.ino !== opened.ino || current.dev !== opened.dev || current.ino !== opened.ino || held.nlink !== 1 || current.nlink !== 1 || (held.mode & 0o777) !== 0o600 || (current.mode & 0o777) !== 0o600 || await realpath(lockPath) !== lockPath) {
        throw new UsfError("PROVIDERS_LEAF_LOCK_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The primary mutation lock changed after acquisition.");
      }
    };
    const release = async (): Promise<void> => {
      if (released) return;
      released = true;
      await handle.close();
    };
    await validate();
    return Object.freeze({ validate, release });
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

export const withSharedProviderLeafImportLock: ProviderLeafImportLock = async (repositoryRoot, action) => {
  const lock = await acquireSharedPrimaryMutationLock(repositoryRoot);
  try { return await action(); }
  finally { await lock.release(); }
};

export const withSharedPrimaryMutationLock: ProviderLeafImportLock = withSharedProviderLeafImportLock;

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

export type FreshLeafFamily = "providers" | "call";

export interface FreshLeafExpectedAuthority {
  readonly work: string;
  readonly contract: string;
  readonly profile: string;
  readonly manifest: string;
  readonly basisDigest: string;
  readonly scopedDependencyDigest: string;
  readonly modulePath: string;
  readonly moduleDigest: string;
  readonly repositoryClosureDigest: string;
  readonly childEntry: FreshLeafChildEntryAuthority;
}

export interface FreshLeafChildEntryAuthority {
  readonly work: "urn:usf:work:operator-observability";
  readonly contract: "urn:usf:contract:operator-observability:1";
  readonly basisDigest: string;
  readonly scopedDependencyDigest: string;
  readonly path: "src/commands/provider-leaf-dispatch.ts" | "src/commands/graph-leaf-dispatch.ts";
  readonly digest: string;
  readonly dependency: RepositoryLeafDependency;
}

export interface FreshLeafWireRequest {
  readonly schema: "urn:usf:dynamic-leaf-child-request:1";
  readonly family: FreshLeafFamily;
  readonly leaf: string;
  readonly args: readonly string[];
  readonly repositoryRoot: string;
  readonly expected: FreshLeafExpectedAuthority;
}

export interface FreshLeafProtocolFixtureRequest {
  readonly schema: "urn:usf:dynamic-leaf-protocol-fixture:1";
  readonly family: "fixture";
  readonly leaf: "no-contact";
  readonly repositoryRoot: string;
  readonly childEntry: RepositoryLeafDependency;
  readonly fixture: RepositoryLeafDependency;
}

export interface FreshLeafLauncherLock {
  readonly validate: () => Promise<void>;
  readonly release: () => Promise<void>;
}

export interface FreshLeafChildInvocation {
  readonly request: FreshLeafWireRequest;
  readonly prepareChild: () => Promise<CommandHandler>;
  readonly validateParentLock: () => Promise<void>;
  readonly releaseParentLock: () => Promise<void>;
}

export type FreshLeafChildRunner = (invocation: FreshLeafChildInvocation) => Promise<CommandResult>;

interface ChildResultSuccess {
  readonly schema: "urn:usf:dynamic-leaf-child-result:1";
  readonly status: "ok";
  readonly result: CommandResult;
}

interface ChildResultFailure {
  readonly schema: "urn:usf:dynamic-leaf-child-result:1";
  readonly status: "refused";
  readonly reasonCode: string;
  readonly exitCode: number;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

type ChildResultEnvelope = ChildResultSuccess | ChildResultFailure;

function freshLeafPrefix(request: Pick<FreshLeafWireRequest, "family" | "leaf">): string {
  if (request.family === "call") return "CALL_LEAF";
  return request.leaf === "host" ? "PROVIDERS_HOST" : "PROVIDERS_RECEIPT";
}

function exactExpectedAuthority(authorization: ProviderLeafAuthorization, childEntry: FreshLeafChildEntryAuthority): FreshLeafExpectedAuthority {
  return Object.freeze({
    work: authorization.work,
    contract: authorization.contract,
    profile: authorization.profile,
    manifest: authorization.manifest,
    basisDigest: authorization.basisDigest,
    scopedDependencyDigest: authorization.scopedDependencyDigest,
    modulePath: authorization.modulePath,
    moduleDigest: authorization.moduleDigest,
    repositoryClosureDigest: authorization.repositoryClosureDigest,
    childEntry,
  });
}

function sameExpectedAuthority(left: FreshLeafExpectedAuthority, right: FreshLeafExpectedAuthority): boolean {
  return left.work === right.work
    && left.contract === right.contract
    && left.profile === right.profile
    && left.manifest === right.manifest
    && left.basisDigest === right.basisDigest
    && left.scopedDependencyDigest === right.scopedDependencyDigest
    && left.modulePath === right.modulePath
    && left.moduleDigest === right.moduleDigest
    && left.repositoryClosureDigest === right.repositoryClosureDigest
    && canonicalDigest(left.childEntry) === canonicalDigest(right.childEntry);
}

function boundedJson(value: unknown, maximumBytes: number, code: string): string {
  let serialized: string;
  try { serialized = JSON.stringify(value); }
  catch { throw new UsfError(code, exitCodes.CONTAINMENT_REFUSAL, "The dynamic leaf protocol value is not serializable JSON."); }
  if (Buffer.byteLength(serialized, "utf8") > maximumBytes) {
    throw new UsfError(code, exitCodes.CONTAINMENT_REFUSAL, "The dynamic leaf protocol value exceeds its graph-defined byte bound.");
  }
  return serialized;
}

function assertWireRequest(value: unknown): asserts value is FreshLeafWireRequest {
  if (!isRecord(value)
    || value.schema !== "urn:usf:dynamic-leaf-child-request:1"
    || (value.family !== "providers" && value.family !== "call")
    || typeof value.leaf !== "string"
    || !Array.isArray(value.args)
    || value.args.some((argument) => typeof argument !== "string")
    || typeof value.repositoryRoot !== "string"
    || !isRecord(value.expected)) {
    throw new UsfError("DYNAMIC_LEAF_CHILD_REQUEST_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The dynamic leaf child request is malformed.");
  }
  const expected = value.expected;
  const exactKeys = ["basisDigest", "childEntry", "contract", "manifest", "moduleDigest", "modulePath", "profile", "repositoryClosureDigest", "scopedDependencyDigest", "work"];
  if (Object.keys(expected).sort(compareText).join("\0") !== exactKeys.join("\0")
    || exactKeys.filter((key) => key !== "childEntry").some((key) => typeof expected[key] !== "string")
    || !isRecord(expected.childEntry)) {
    throw new UsfError("DYNAMIC_LEAF_CHILD_REQUEST_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The dynamic leaf child authority expectation is malformed.");
  }
  const childEntry = expected.childEntry;
  const childKeys = ["basisDigest", "contract", "dependency", "digest", "path", "scopedDependencyDigest", "work"];
  if (Object.keys(childEntry).sort(compareText).join("\0") !== childKeys.join("\0")
    || childKeys.filter((key) => key !== "dependency").some((key) => typeof childEntry[key] !== "string")
    || childEntry.work !== "urn:usf:work:operator-observability"
    || childEntry.contract !== "urn:usf:contract:operator-observability:1"
    || (childEntry.path !== "src/commands/provider-leaf-dispatch.ts" && childEntry.path !== "src/commands/graph-leaf-dispatch.ts")
    || !isRecord(childEntry.dependency)) {
    throw new UsfError("DYNAMIC_LEAF_CHILD_REQUEST_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The dynamic leaf child entry authority is malformed.");
  }
  boundedJson(value, childControlMaximumBytes, "DYNAMIC_LEAF_CHILD_CONTROL_REFUSED");
}

function childResultFailure(error: unknown): ChildResultFailure {
  if (error instanceof UsfError) {
    return {
      schema: "urn:usf:dynamic-leaf-child-result:1",
      status: "refused",
      reasonCode: error.code,
      exitCode: error.exitCode,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    };
  }
  return {
    schema: "urn:usf:dynamic-leaf-child-result:1",
    status: "refused",
    reasonCode: "DYNAMIC_LEAF_CHILD_INTERNAL_ERROR",
    exitCode: exitCodes.DOMAIN_FAILURE,
    message: "The fresh dynamic leaf child failed before producing a result.",
  };
}

function restoreChildResult(value: unknown, prefix: string): CommandResult {
  if (!isRecord(value) || value.schema !== "urn:usf:dynamic-leaf-child-result:1" || (value.status !== "ok" && value.status !== "refused")) {
    throw new UsfError(prefix + "_CHILD_RESULT_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The fresh dynamic leaf child returned a malformed result envelope.");
  }
  if (value.status === "refused") {
    if (typeof value.reasonCode !== "string" || !/^[A-Z][A-Z0-9_]{1,95}$/u.test(value.reasonCode)
      || typeof value.exitCode !== "number" || !Object.values(exitCodes).includes(value.exitCode as never)
      || typeof value.message !== "string" || value.message.length === 0
      || (value.details !== undefined && !isRecord(value.details))) {
      throw new UsfError(prefix + "_CHILD_RESULT_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The fresh dynamic leaf child refusal is malformed.");
    }
    throw new UsfError(value.reasonCode, value.exitCode as (typeof exitCodes)[keyof typeof exitCodes], value.message, value.details as Record<string, unknown> | undefined);
  }
  if (!isRecord(value.result)
    || !Object.prototype.hasOwnProperty.call(value.result, "output")
    || Object.keys(value.result).some((key) => key !== "output" && key !== "exitCode" && key !== "outputMode")
    || (value.result.exitCode !== undefined && (typeof value.result.exitCode !== "number" || !Object.values(exitCodes).includes(value.result.exitCode as never)))
    || (value.result.outputMode !== undefined && value.result.outputMode !== "text" && value.result.outputMode !== "json")) {
    throw new UsfError(prefix + "_CHILD_RESULT_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The fresh dynamic leaf child command result is malformed.");
  }
  return value.result as unknown as CommandResult;
}

async function readBoundedChildResult(stream: Readable, prefix: string): Promise<ChildResultEnvelope> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const value of stream) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
    total += chunk.byteLength;
    if (total > childOutputMaximumBytes) {
      throw new UsfError(prefix + "_CHILD_OUTPUT_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The fresh dynamic leaf child exceeded the graph-defined result bound.");
    }
    chunks.push(chunk);
  }
  let parsed: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new UsfError(prefix + "_CHILD_RESULT_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The fresh dynamic leaf child result is not bounded UTF-8 JSON.");
  }
  return parsed as ChildResultEnvelope;
}

function childExit(child: ChildProcess): Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }> {
  return new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
  });
}

async function terminateChild(child: ChildProcess, exit: Promise<unknown>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    exit.then(() => true, () => true),
    new Promise<boolean>((resolveTimeout) => setTimeout(() => resolveTimeout(false), childTerminationGraceMilliseconds)),
  ]);
  if (!exited && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

/**
 * Production fresh-child transport. The entry override selects only one of the
 * two graph-defined operator-owned child entries; it never selects a handler.
 */
export async function invokeFreshLeafChildProcess(
  request: FreshLeafWireRequest | FreshLeafProtocolFixtureRequest | Readonly<Record<string, unknown>>,
  validateParentLock: () => Promise<void>,
  releaseParentLock: () => Promise<void>,
  childEntry = fileURLToPath(import.meta.url),
): Promise<CommandResult> {
  const wire = request as FreshLeafWireRequest | FreshLeafProtocolFixtureRequest;
  const prefix = isRecord(wire) && (wire.family === "providers" || wire.family === "call") && typeof wire.leaf === "string"
    ? freshLeafPrefix(wire)
    : "DYNAMIC_LEAF_FIXTURE";
  const serializedRequest = boundedJson(request, childControlMaximumBytes, prefix + "_CHILD_CONTROL_REFUSED");
  let released = false;
  const release = async (): Promise<void> => {
    if (released) return;
    released = true;
    await releaseParentLock();
  };
  const child = spawn(process.execPath, [childEntry, childEntryArgument], {
    cwd: wire.repositoryRoot,
    env: Object.freeze({ LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC" }),
    shell: false,
    stdio: ["inherit", "ignore", "ignore", "ipc", "pipe"],
  });
  const exit = childExit(child);
  const resultStream = child.stdio[4];
  if (resultStream === null || typeof resultStream === "number") {
    await release();
    await terminateChild(child, exit);
    throw new UsfError(prefix + "_CHILD_PROTOCOL_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The fresh dynamic leaf child result pipe is unavailable.");
  }
  const result = readBoundedChildResult(resultStream as Readable, prefix);
  void result.catch(() => undefined);
  void exit.catch(() => undefined);
  try {
    let admissionTimer: NodeJS.Timeout | undefined;
    const prepared = new Promise<void>((resolvePrepared, rejectPrepared) => {
      admissionTimer = setTimeout(() => {
        rejectPrepared(new UsfError(prefix + "_CHILD_ADMISSION_TIMEOUT", exitCodes.CURRENTNESS_FAILURE, "The fresh dynamic leaf child did not prepare within 30000 milliseconds."));
      }, childAdmissionTimeoutMilliseconds);
      child.once("message", (message) => {
        if (admissionTimer !== undefined) clearTimeout(admissionTimer);
        try {
          boundedJson(message, childControlMaximumBytes, prefix + "_CHILD_CONTROL_REFUSED");
          if (!isRecord(message) || message.schema !== "urn:usf:dynamic-leaf-child-control:1" || message.status !== "prepared" || Object.keys(message).sort(compareText).join("\0") !== "schema\0status") {
            throw new UsfError(prefix + "_CHILD_PROTOCOL_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The fresh dynamic leaf child did not emit the exact prepared control message.");
          }
          resolvePrepared();
        } catch (error) { rejectPrepared(error); }
      });
    });
    await new Promise<void>((resolveSend, rejectSend) => {
      child.send(JSON.parse(serializedRequest), (error) => error === null ? resolveSend() : rejectSend(error));
    });
    try {
      await Promise.race([
        prepared,
        result.then((envelope) => {
          restoreChildResult(envelope, prefix);
          throw new UsfError(prefix + "_CHILD_PROTOCOL_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The fresh dynamic leaf child returned before preparation.");
        }),
        exit.then(({ code, signal }) => {
          throw new UsfError(prefix + "_CHILD_PROTOCOL_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The fresh dynamic leaf child exited before preparation.", { code, signal });
        }),
      ]);
    } finally {
      if (admissionTimer !== undefined) clearTimeout(admissionTimer);
    }
    await validateParentLock();
    await release();
    await new Promise<void>((resolveSend, rejectSend) => {
      child.send({ schema: "urn:usf:dynamic-leaf-child-control:1", status: "acknowledged" }, (error) => error === null ? resolveSend() : rejectSend(error));
    });
    const envelope = await result;
    const commandResult = restoreChildResult(envelope, prefix);
    const terminated = await exit;
    if (terminated.code !== 0 || terminated.signal !== null) {
      throw new UsfError(prefix + "_CHILD_PROTOCOL_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The fresh dynamic leaf child exited abnormally after returning a result.", terminated);
    }
    return commandResult;
  } catch (error) {
    await release();
    await terminateChild(child, exit);
    throw error;
  }
}

export async function inheritedLauncherLock(repositoryRoot: string, family: FreshLeafFamily, leaf: string): Promise<FreshLeafLauncherLock> {
  const prefix = family === "call" ? "CALL_LEAF" : leaf === "host" ? "PROVIDERS_HOST" : "PROVIDERS_RECEIPT";
  const expectedLeaf = family + ":" + leaf;
  const descriptorText = process.env[launcherLockFileDescriptorEnvironment];
  if (process.env[launcherLeafEnvironment] !== expectedLeaf || descriptorText === undefined || !/^[3-9][0-9]{0,3}$/u.test(descriptorText)) {
    throw new UsfError(prefix + "_LAUNCHER_LOCK_REQUIRED", exitCodes.CONTAINMENT_REFUSAL, "The dynamic leaf must enter through the stable usf launcher-held shared lock.");
  }
  const descriptor = Number(descriptorText);
  const lockPath = resolve(repositoryRoot, ".usf/locks/primary-mutation.lock");
  let released = false;
  const validate = async (): Promise<void> => {
    if (released) throw new UsfError(prefix + "_LAUNCHER_LOCK_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The stable launcher lock was released before child preparation.");
    try {
      const trustedFlock = lstatSync("/usr/bin/flock");
      const named = lstatSync(lockPath);
      const opened = fstatSync(descriptor);
      const linked = await realpath(`/proc/self/fd/${descriptor}`);
      const information = readFileSync(`/proc/self/fdinfo/${descriptor}`, "utf8");
      const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
      if (!trustedFlock.isFile() || trustedFlock.isSymbolicLink() || trustedFlock.uid !== 0 || (trustedFlock.mode & 0o022) !== 0 || (trustedFlock.mode & 0o111) === 0
        || !named.isFile() || named.isSymbolicLink() || !opened.isFile() || uid === undefined || named.uid !== uid || opened.uid !== uid
        || named.nlink !== 1 || opened.nlink !== 1 || (named.mode & 0o777) !== 0o600 || (opened.mode & 0o777) !== 0o600
        || named.dev !== opened.dev || named.ino !== opened.ino || linked !== lockPath
        || !/^lock:\s+\d+:\s+FLOCK\s+ADVISORY\s+READ\s+/mu.test(information)) {
        throw new Error("unsafe-launcher-lock");
      }
    } catch {
      throw new UsfError(prefix + "_LAUNCHER_LOCK_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The inherited stable-launcher descriptor is not the exact owner-private shared primary-mutation lock.");
    }
  };
  const release = async (): Promise<void> => {
    if (released) return;
    released = true;
    delete process.env[launcherLockFileDescriptorEnvironment];
    delete process.env[launcherLeafEnvironment];
    try { closeSync(descriptor); }
    catch { throw new UsfError(prefix + "_LAUNCHER_LOCK_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The inherited stable-launcher lock could not be released exactly once."); }
  };
  await validate();
  return Object.freeze({ validate, release });
}

function validateProviderAuthorization(
  authorization: ProviderLeafAuthorization,
  leaf: ProviderLeafName,
  repositoryRoot: string,
  expected?: FreshLeafExpectedAuthority,
): readonly ProviderLeafRepositoryDependency[] {
  const definition = definitions[leaf];
  if (authorization.leaf !== leaf
    || authorization.work !== definition.work
    || authorization.contract !== definition.contract
    || authorization.repositoryRoot !== repositoryRoot
    || authorization.modulePath !== definition.modulePath
    || !digestPattern.test(authorization.basisDigest)
    || !digestPattern.test(authorization.moduleDigest)
    || !digestPattern.test(authorization.scopedDependencyDigest)) {
    return repositoryDependencyRefused(definition, "The leaf authorization ticket does not bind the exact module, owner, basis and scoped dependency.");
  }
  const repositoryDependencies = exactTicketDependencies(authorization, definition);
  if (expected !== undefined && !sameExpectedAuthority(exactExpectedAuthority(authorization, expected.childEntry), expected)) {
    return repositoryDependencyRefused(definition, "The child re-admission does not match the parent-admitted authority identity.");
  }
  return repositoryDependencies;
}

async function prepareProviderChild(
  leaf: ProviderLeafName,
  leafArgs: readonly string[],
  repositoryRoot: string,
  expected: FreshLeafExpectedAuthority,
  dependencies: {
    readonly authorize: ProviderLeafAuthorizer;
    readonly authenticate: ProviderLeafAuthenticator;
    readonly load: ProviderLeafLoader;
    readonly withImportLock: ProviderLeafImportLock;
    readonly authorizeChildEntry: FreshLeafChildEntryAuthorizer;
    readonly authenticateChildEntry: typeof authenticateFreshLeafChildEntry;
  },
): Promise<CommandHandler> {
  const definition = definitions[leaf];
  return dependencies.withImportLock(repositoryRoot, async () => {
    const childEntry = await dependencies.authorizeChildEntry({
      repositoryRoot,
      profile: expected.profile,
      manifest: expected.manifest,
      featureWork: definition.work,
      path: "src/commands/provider-leaf-dispatch.ts",
    });
    if (canonicalDigest(childEntry) !== canonicalDigest(expected.childEntry)) {
      return repositoryDependencyRefused(definition, "The child re-admission does not match the parent-admitted operator child entry.");
    }
    await dependencies.authenticateChildEntry(repositoryRoot, childEntry);
    const authorization = await dependencies.authorize(Object.freeze({
      leaf,
      args: leafArgs,
      repositoryRoot,
      proofblockedCode: definition.proofblockedCode,
    }));
    const repositoryDependencies = validateProviderAuthorization(authorization, leaf, repositoryRoot, expected);
    await dependencies.authenticate(authorization, repositoryDependencies);
    const moduleUrl = pathToFileURL(resolve(repositoryRoot, definition.modulePath)).href;
    let loaded: Record<string, unknown>;
    try {
      const candidate = await dependencies.load(moduleUrl);
      if (!isRecord(candidate)) return unavailable(definition);
      loaded = candidate;
    } catch (error) {
      const code = isRecord(error) && typeof error.code === "string" ? error.code : undefined;
      const missingUrl = isRecord(error) && typeof error.url === "string" ? error.url : undefined;
      if (code === "ERR_MODULE_NOT_FOUND" && missingUrl === moduleUrl) {
        throw new UsfError(definition.proofblockedCode, exitCodes.DOMAIN_FAILURE, definition.proofblockedMessage);
      }
      throw error;
    }
    const selected = loaded[definition.handlerExport];
    if (typeof selected !== "function") return unavailable(definition);
    const moduleDependency = repositoryDependencies.find((dependency) => dependency.path === definition.modulePath)!;
    await dependencies.authenticate(authorization, Object.freeze([moduleDependency]));
    await dependencies.authenticateChildEntry(repositoryRoot, childEntry);
    return selected as CommandHandler;
  });
}

export function createProviderLeafDispatcher(
  dependencies: {
    readonly authorize?: ProviderLeafAuthorizer;
    readonly authenticate?: ProviderLeafAuthenticator;
    readonly load?: ProviderLeafLoader;
    readonly withImportLock?: ProviderLeafImportLock;
    readonly launcherLock?: (repositoryRoot: string, family: FreshLeafFamily, leaf: string) => Promise<FreshLeafLauncherLock>;
    readonly runChild?: FreshLeafChildRunner;
    readonly authorizeChildEntry?: FreshLeafChildEntryAuthorizer;
    readonly authenticateChildEntry?: typeof authenticateFreshLeafChildEntry;
  } = {},
): (args: readonly string[], repositoryRoot: string) => Promise<CommandResult | null> {
  const authorize = dependencies.authorize ?? authorizeCurrentProviderLeaf;
  const authenticate = dependencies.authenticate ?? authenticateProviderLeafRepositoryDependencies;
  const load = dependencies.load ?? ((moduleSpecifier: string) => import(moduleSpecifier));
  const withImportLock = dependencies.withImportLock ?? withSharedProviderLeafImportLock;
  const getLauncherLock = dependencies.launcherLock ?? inheritedLauncherLock;
  const authorizeChildEntry = dependencies.authorizeChildEntry ?? authorizeCurrentFreshLeafChildEntry;
  const authenticateChildEntry = dependencies.authenticateChildEntry ?? authenticateFreshLeafChildEntry;
  const runChild: FreshLeafChildRunner = dependencies.runChild ?? ((invocation) => invokeFreshLeafChildProcess(
    invocation.request,
    invocation.validateParentLock,
    invocation.releaseParentLock,
  ));
  return async (args, repositoryRoot) => {
    const leaf = args[0];
    if (leaf !== "host" && leaf !== "receipt") return null;
    const definition = definitions[leaf];
    const leafArgs = args.slice(1);
    await requireImplementationRoot(repositoryRoot, definition);
    const launcherLock = await getLauncherLock(repositoryRoot, "providers", leaf);
    let released = false;
    const releaseParentLock = async (): Promise<void> => {
      if (released) return;
      released = true;
      await launcherLock.release();
    };
    try {
      await launcherLock.validate();
      const authorization = await authorize(Object.freeze({
        leaf,
        args: leafArgs,
        repositoryRoot,
        proofblockedCode: definition.proofblockedCode,
      }));
      const repositoryDependencies = validateProviderAuthorization(authorization, leaf, repositoryRoot);
      const childEntry = await authorizeChildEntry({
        repositoryRoot,
        profile: authorization.profile,
        manifest: authorization.manifest,
        featureWork: authorization.work,
        path: "src/commands/provider-leaf-dispatch.ts",
      });
      await authenticateChildEntry(repositoryRoot, childEntry);
      await authenticate(authorization, repositoryDependencies);
      const moduleDependency = repositoryDependencies.find((dependency) => dependency.path === definition.modulePath)!;
      await authenticate(authorization, Object.freeze([moduleDependency]));
      await launcherLock.validate();
      const expected = exactExpectedAuthority(authorization, childEntry);
      return await runChild(Object.freeze({
        request: Object.freeze({
          schema: "urn:usf:dynamic-leaf-child-request:1",
          family: "providers",
          leaf,
          args: Object.freeze([...leafArgs]),
          repositoryRoot,
          expected,
        }),
        prepareChild: async () => prepareProviderChild(leaf, leafArgs, repositoryRoot, expected, { authorize, authenticate, load, withImportLock, authorizeChildEntry, authenticateChildEntry }),
        validateParentLock: launcherLock.validate,
        releaseParentLock,
      }));
    } finally {
      await releaseParentLock();
    }
  };
}

async function receiveChildMessage(): Promise<unknown> {
  return new Promise((resolveMessage, rejectMessage) => {
    if (typeof process.send !== "function") {
      rejectMessage(new UsfError("DYNAMIC_LEAF_CHILD_PROTOCOL_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The private dynamic leaf control channel is unavailable."));
      return;
    }
    process.once("message", resolveMessage);
    process.once("disconnect", () => rejectMessage(new UsfError("DYNAMIC_LEAF_CHILD_PROTOCOL_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The private dynamic leaf control channel closed early.")));
  });
}

async function sendChildMessage(value: unknown): Promise<void> {
  boundedJson(value, childControlMaximumBytes, "DYNAMIC_LEAF_CHILD_CONTROL_REFUSED");
  await new Promise<void>((resolveSend, rejectSend) => {
    if (typeof process.send !== "function") {
      rejectSend(new UsfError("DYNAMIC_LEAF_CHILD_PROTOCOL_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The private dynamic leaf control channel is unavailable."));
      return;
    }
    process.send(value, undefined, undefined, (error: Error | null) => error === null ? resolveSend() : rejectSend(error));
  });
}

function assertProtocolFixtureRequest(value: unknown): asserts value is FreshLeafProtocolFixtureRequest {
  if (!isRecord(value)
    || value.schema !== "urn:usf:dynamic-leaf-protocol-fixture:1"
    || value.family !== "fixture"
    || value.leaf !== "no-contact"
    || typeof value.repositoryRoot !== "string"
    || !isRecord(value.childEntry)
    || !isRecord(value.fixture)
    || Object.keys(value).sort(compareText).join("\0") !== "childEntry\0family\0fixture\0leaf\0repositoryRoot\0schema") {
    throw new UsfError("DYNAMIC_LEAF_FIXTURE_REQUEST_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The exact-carrier fresh-child protocol fixture is malformed.");
  }
  for (const dependency of [value.childEntry, value.fixture]) {
    if (typeof dependency.path !== "string" || typeof dependency.digest !== "string" || !digestPattern.test(dependency.digest)
      || !Array.isArray(dependency.roles) || dependency.roles.length !== 1 || dependency.roles[0] !== "file") {
      throw new UsfError("DYNAMIC_LEAF_FIXTURE_REQUEST_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The exact-carrier fresh-child protocol fixture dependency is malformed.");
    }
  }
  if (value.childEntry.path !== "src/commands/provider-leaf-dispatch.ts"
    || typeof value.fixture.path !== "string"
    || !/^\.usf\/inputs\/operator-fresh-child-[0-9]+\.mjs$/u.test(value.fixture.path)) {
    throw new UsfError("DYNAMIC_LEAF_FIXTURE_REQUEST_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The exact-carrier protocol fixture paths are not the sanctioned child entry and owner-private input.");
  }
  boundedJson(value, childControlMaximumBytes, "DYNAMIC_LEAF_FIXTURE_CONTROL_REFUSED");
}

export async function invokeFreshLeafProtocolFixture(
  repositoryRoot: string,
  fixturePath: string,
  fixtureDigest: string,
): Promise<CommandResult> {
  const childEntryPath = "src/commands/provider-leaf-dispatch.ts";
  const childEntry: RepositoryLeafDependency = Object.freeze({
    path: childEntryPath,
    digest: sha256(readFileSync(resolve(repositoryRoot, childEntryPath))),
    roles: Object.freeze(["file"] as const),
  });
  const fixture: RepositoryLeafDependency = Object.freeze({ path: fixturePath, digest: fixtureDigest, roles: Object.freeze(["file"] as const) });
  const request: FreshLeafProtocolFixtureRequest = Object.freeze({
    schema: "urn:usf:dynamic-leaf-protocol-fixture:1",
    family: "fixture",
    leaf: "no-contact",
    repositoryRoot,
    childEntry,
    fixture,
  });
  assertProtocolFixtureRequest(request);
  const fixtureAbsolutePath = resolve(repositoryRoot, fixturePath);
  const inputDirectory = resolve(repositoryRoot, ".usf/inputs");
  const inputDirectoryMetadata = await lstat(inputDirectory);
  const fixtureMetadata = await lstat(fixtureAbsolutePath);
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  if (!inputDirectoryMetadata.isDirectory() || inputDirectoryMetadata.isSymbolicLink() || uid === undefined || inputDirectoryMetadata.uid !== uid || (inputDirectoryMetadata.mode & 0o777) !== 0o700 || await realpath(inputDirectory) !== inputDirectory
    || !fixtureMetadata.isFile() || fixtureMetadata.isSymbolicLink() || fixtureMetadata.uid !== uid || fixtureMetadata.nlink !== 1 || (fixtureMetadata.mode & 0o777) !== 0o600 || await realpath(fixtureAbsolutePath) !== fixtureAbsolutePath) {
    throw new UsfError("DYNAMIC_LEAF_FIXTURE_DEPENDENCY_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The parent refused a non-private exact-carrier protocol fixture.");
  }
  const parentLock = await acquireSharedPrimaryMutationLock(repositoryRoot);
  try {
    await authenticateRepositoryLeafDependencies(repositoryRoot, Object.freeze([childEntry, fixture]), "DYNAMIC_LEAF_FIXTURE_DEPENDENCY_REFUSED");
    await parentLock.validate();
    return await invokeFreshLeafChildProcess(request, parentLock.validate, parentLock.release, fileURLToPath(import.meta.url));
  } finally {
    await parentLock.release();
  }
}

async function prepareProtocolFixture(request: FreshLeafProtocolFixtureRequest): Promise<CommandHandler> {
  if (await realpath(request.repositoryRoot) !== await realpath(implementationRoot)) {
    throw new UsfError("DYNAMIC_LEAF_FIXTURE_ROOT_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The exact-carrier protocol fixture must use the implementation root.");
  }
  const fixturePath = resolve(request.repositoryRoot, request.fixture.path);
  const inputDirectory = resolve(request.repositoryRoot, ".usf/inputs");
  const inputDirectoryMetadata = await lstat(inputDirectory);
  const metadata = await lstat(fixturePath);
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  if (!inputDirectoryMetadata.isDirectory() || inputDirectoryMetadata.isSymbolicLink() || uid === undefined || inputDirectoryMetadata.uid !== uid || (inputDirectoryMetadata.mode & 0o777) !== 0o700 || await realpath(inputDirectory) !== inputDirectory
    || !metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== uid || metadata.nlink !== 1 || (metadata.mode & 0o777) !== 0o600 || await realpath(fixturePath) !== fixturePath) {
    throw new UsfError("DYNAMIC_LEAF_FIXTURE_DEPENDENCY_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The exact-carrier protocol fixture is not one owner-private exact file.");
  }
  return withSharedProviderLeafImportLock(request.repositoryRoot, async () => {
    const dependencies = Object.freeze([request.childEntry, request.fixture]);
    await authenticateRepositoryLeafDependencies(request.repositoryRoot, dependencies, "DYNAMIC_LEAF_FIXTURE_DEPENDENCY_REFUSED");
    const loaded = await import(pathToFileURL(fixturePath).href) as Record<string, unknown>;
    await authenticateRepositoryLeafDependencies(request.repositoryRoot, dependencies, "DYNAMIC_LEAF_FIXTURE_DEPENDENCY_REFUSED");
    if (typeof loaded.fixtureValue !== "string") {
      throw new UsfError("DYNAMIC_LEAF_FIXTURE_DEPENDENCY_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The exact-carrier protocol fixture does not expose its bounded no-contact value.");
    }
    const fixtureValue = loaded.fixtureValue;
    return () => ({
      output: Object.freeze({
        schema: "urn:usf:dynamic-leaf-protocol-fixture-result:1",
        status: "ok",
        fixtureValue,
        credentialInherited: Object.keys(process.env).some((name) => /(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/u.test(name)),
        proxyInherited: Object.keys(process.env).some((name) => /^(?:ALL|HTTP|HTTPS|NO)_PROXY$/u.test(name)),
        nodeOptionsInherited: process.env.NODE_OPTIONS !== undefined,
      }),
    });
  });
}

export async function runDynamicLeafChild(): Promise<void> {
  try {
    const rawRequest = await receiveChildMessage();
    if (isRecord(rawRequest) && rawRequest.schema === "urn:usf:dynamic-leaf-protocol-fixture:1") {
      assertProtocolFixtureRequest(rawRequest);
      const handler = await prepareProtocolFixture(rawRequest);
      await sendChildMessage({ schema: "urn:usf:dynamic-leaf-child-control:1", status: "prepared" });
      const acknowledgement = await receiveChildMessage();
      boundedJson(acknowledgement, childControlMaximumBytes, "DYNAMIC_LEAF_CHILD_CONTROL_REFUSED");
      if (!isRecord(acknowledgement)
        || acknowledgement.schema !== "urn:usf:dynamic-leaf-child-control:1"
        || acknowledgement.status !== "acknowledged"
        || Object.keys(acknowledgement).sort(compareText).join("\0") !== "schema\0status") {
        throw new UsfError("DYNAMIC_LEAF_CHILD_PROTOCOL_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The parent did not acknowledge lock release before fixture execution.");
      }
      const result = await handler({ command: "providers", args: [], repositoryRoot: rawRequest.repositoryRoot });
      const envelope: ChildResultSuccess = { schema: "urn:usf:dynamic-leaf-child-result:1", status: "ok", result };
      writeFileSync(4, boundedJson(envelope, childOutputMaximumBytes, "DYNAMIC_LEAF_CHILD_OUTPUT_REFUSED"), "utf8");
      return;
    }
    assertWireRequest(rawRequest);
    const request = rawRequest;
    let handler: CommandHandler;
    if (request.family === "providers") {
      if (request.leaf !== "host" && request.leaf !== "receipt") throw new UsfError("DYNAMIC_LEAF_CHILD_REQUEST_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The provider child leaf is unsupported.");
      await requireImplementationRoot(request.repositoryRoot, definitions[request.leaf]);
      handler = await prepareProviderChild(request.leaf, request.args, request.repositoryRoot, request.expected, {
        authorize: authorizeCurrentProviderLeaf,
        authenticate: authenticateProviderLeafRepositoryDependencies,
        load: (specifier) => import(specifier),
        withImportLock: withSharedProviderLeafImportLock,
        authorizeChildEntry: authorizeCurrentFreshLeafChildEntry,
        authenticateChildEntry: authenticateFreshLeafChildEntry,
      });
    } else {
      const graph = await import("./graph-leaf-dispatch.ts");
      handler = await graph.prepareCurrentGraphLeafChild(request);
    }
    await sendChildMessage({ schema: "urn:usf:dynamic-leaf-child-control:1", status: "prepared" });
    const acknowledgement = await receiveChildMessage();
    boundedJson(acknowledgement, childControlMaximumBytes, "DYNAMIC_LEAF_CHILD_CONTROL_REFUSED");
    if (!isRecord(acknowledgement)
      || acknowledgement.schema !== "urn:usf:dynamic-leaf-child-control:1"
      || acknowledgement.status !== "acknowledged"
      || Object.keys(acknowledgement).sort(compareText).join("\0") !== "schema\0status") {
      throw new UsfError("DYNAMIC_LEAF_CHILD_PROTOCOL_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The parent did not acknowledge lock release before leaf execution.");
    }
    const result = await handler({ command: request.family === "providers" ? "providers" : "call", args: request.args, repositoryRoot: request.repositoryRoot });
    const envelope: ChildResultSuccess = { schema: "urn:usf:dynamic-leaf-child-result:1", status: "ok", result };
    writeFileSync(4, boundedJson(envelope, childOutputMaximumBytes, "DYNAMIC_LEAF_CHILD_OUTPUT_REFUSED"), "utf8");
  } catch (error) {
    const envelope = childResultFailure(error);
    try { writeFileSync(4, boundedJson(envelope, childOutputMaximumBytes, "DYNAMIC_LEAF_CHILD_OUTPUT_REFUSED"), "utf8"); }
    catch {
      writeFileSync(4, JSON.stringify(childResultFailure(new UsfError("DYNAMIC_LEAF_CHILD_OUTPUT_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The dynamic leaf child could not emit a bounded result."))), "utf8");
    }
  } finally {
    if (process.connected) process.disconnect();
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv[2] === childEntryArgument) {
  void runDynamicLeafChild().then(
    () => process.exit(0),
    () => process.exit(1),
  );
}
