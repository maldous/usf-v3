import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { canonicalDigest } from "../core/canonical.ts";
import { exitCodes, UsfError } from "../core/errors.ts";
import type { RealisationBasis } from "../realisation/basis.ts";
import type { CommandHandler, CommandResult } from "./dispatcher.ts";
import {
  authenticateRepositoryLeafDependencies,
  authenticateFreshLeafChildEntry,
  authorizeCurrentFreshLeafChildEntry,
  deriveRepositoryLeafDependencies,
  inheritedLauncherLock,
  invokeFreshLeafChildProcess,
  runDynamicLeafChild,
  withSharedPrimaryMutationLock,
  type FreshLeafChildRunner,
  type FreshLeafChildEntryAuthority,
  type FreshLeafChildEntryAuthorizer,
  type FreshLeafExpectedAuthority,
  type FreshLeafFamily,
  type FreshLeafLauncherLock,
  type FreshLeafWireRequest,
  type ProviderLeafImportLock,
  type RepositoryLeafDependency,
} from "./provider-leaf-dispatch.ts";

export type GraphLeafName = "parallel" | "compare";

export interface GraphLeafAuthorityRequest {
  readonly leaf: GraphLeafName;
  readonly args: readonly string[];
  readonly repositoryRoot: string;
}

export interface GraphLeafAuthorization {
  readonly leaf: GraphLeafName;
  readonly work: "urn:usf:work:provider-parallel-execution";
  readonly contract: "urn:usf:contract:provider-parallel-execution:1";
  readonly profile: string;
  readonly manifest: string;
  readonly repositoryRoot: string;
  readonly basisDigest: string;
  readonly scopedDependencyDigest: string;
  readonly modulePath: "src/commands/provider-parallel.ts";
  readonly moduleDigest: string;
  readonly repositoryDependencies: readonly RepositoryLeafDependency[];
  readonly repositoryClosureDigest: string;
}

export type GraphLeafAuthorizer = (request: GraphLeafAuthorityRequest) => GraphLeafAuthorization | Promise<GraphLeafAuthorization>;
export type GraphLeafLoader = (specifier: string) => Promise<unknown>;

const ownerWork = "urn:usf:work:provider-parallel-execution" as const;
const ownerContract = "urn:usf:contract:provider-parallel-execution:1" as const;
const entryModulePath = "src/commands/provider-parallel.ts" as const;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const repositoryRoles = new Set(["file", "policy", "schema", "tool"]);
const implementationRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const definitions = Object.freeze({
  parallel: Object.freeze({ handlerExport: "parallelCommandHandler" }),
  compare: Object.freeze({ handlerExport: "compareCommandHandler" }),
} satisfies Readonly<Record<GraphLeafName, { readonly handlerExport: string }>>);

interface GraphLeafScope {
  readonly profile: string;
  readonly manifest: string;
  readonly input: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(
  code: string,
  exitCode: (typeof exitCodes)[keyof typeof exitCodes],
  message: string,
  details?: Record<string, unknown>,
): never {
  throw new UsfError(code, exitCode, message, details);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function parseGraphLeafScope(args: readonly string[]): GraphLeafScope {
  if (args.length !== 6) {
    return fail("CALL_LEAF_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, "Graph call leaves require exactly one --profile, --manifest and --input option/value pair.");
  }
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if ((option !== "--profile" && option !== "--manifest" && option !== "--input")
      || value === undefined || value.length === 0 || value.startsWith("--") || values.has(option)) {
      return fail("CALL_LEAF_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, "Graph call leaves require exact non-duplicated option/value pairs.");
    }
    values.set(option, value);
  }
  const profile = values.get("--profile");
  const manifest = values.get("--manifest");
  const input = values.get("--input");
  if (profile === undefined || manifest === undefined || input === undefined) {
    return fail("CALL_LEAF_SCOPE_REQUIRED", exitCodes.INVALID_INPUT, "Graph call leaves require explicit --profile, --manifest and --input scope.");
  }
  return Object.freeze({ profile, manifest, input });
}

function exactTicketDependencies(authorization: GraphLeafAuthorization): readonly RepositoryLeafDependency[] {
  const dependencies = authorization.repositoryDependencies;
  if (!Array.isArray(dependencies) || dependencies.length === 0) {
    return fail("CALL_LEAF_DEPENDENCY_REFUSED", exitCodes.CURRENTNESS_FAILURE, "The graph leaf authorization has no canonical repository closure.");
  }
  let previousPath: string | undefined;
  let moduleCount = 0;
  for (const dependency of dependencies) {
    if (!isRecord(dependency)
      || typeof dependency.path !== "string"
      || dependency.path.length === 0
      || dependency.path.startsWith("/")
      || dependency.path.includes("\\")
      || dependency.path.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..")
      || typeof dependency.digest !== "string"
      || !digestPattern.test(dependency.digest)
      || !Array.isArray(dependency.roles)
      || dependency.roles.length === 0
      || (previousPath !== undefined && compareText(previousPath, dependency.path) >= 0)) {
      return fail("CALL_LEAF_DEPENDENCY_REFUSED", exitCodes.CURRENTNESS_FAILURE, "The graph leaf repository closure is malformed or non-canonical.");
    }
    let previousRole: string | undefined;
    for (const role of dependency.roles) {
      if (typeof role !== "string" || !repositoryRoles.has(role) || (previousRole !== undefined && compareText(previousRole, role) >= 0)) {
        return fail("CALL_LEAF_DEPENDENCY_REFUSED", exitCodes.CURRENTNESS_FAILURE, "The graph leaf repository roles are not exact and canonical.");
      }
      previousRole = role;
    }
    if (dependency.path === entryModulePath) {
      moduleCount += 1;
      if (dependency.digest !== authorization.moduleDigest) {
        return fail("CALL_LEAF_DEPENDENCY_REFUSED", exitCodes.CURRENTNESS_FAILURE, "The graph leaf module digest is inconsistent with its repository closure.");
      }
    }
    previousPath = dependency.path;
  }
  if (moduleCount !== 1
    || !digestPattern.test(authorization.repositoryClosureDigest)
    || canonicalDigest(dependencies) !== authorization.repositoryClosureDigest) {
    return fail("CALL_LEAF_DEPENDENCY_REFUSED", exitCodes.CURRENTNESS_FAILURE, "The graph leaf authorization does not bind one exact repository closure.");
  }
  return dependencies;
}

async function authorizeCurrentGraphLeaf(request: GraphLeafAuthorityRequest): Promise<GraphLeafAuthorization> {
  const parsed = parseGraphLeafScope(request.args);
  const [{ validateRepositoryManifest, validateVersionedProfile }, { loadSemanticGraph }, workModule, basisModule] = await Promise.all([
    import("../continuous/lifecycle.ts"),
    import("../graph/index.ts"),
    import("../graph/work.ts"),
    import("../realisation/basis.ts"),
  ]);
  let profile: string;
  let manifest: string;
  try {
    profile = validateVersionedProfile(parsed.profile);
    manifest = validateRepositoryManifest(parsed.manifest);
  } catch {
    return fail("CALL_LEAF_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, "The selected graph call leaf profile or manifest is invalid.");
  }
  let packet: import("../graph/work.ts").WorkPacket;
  try {
    const result = workModule.deriveWork(loadSemanticGraph(request.repositoryRoot, manifest), {
      profile,
      selector: ownerWork,
      maxItems: 1,
});
    if (result.status !== "ok" || result.items?.length !== 1 || result.items[0]?.id !== ownerWork || result.items[0].contract !== ownerContract) {
      return fail("CALL_LEAF_SCOPE_REFUSED", exitCodes.CURRENTNESS_FAILURE, "The selected profile does not resolve the exact graph call leaf owner.");
    }
    packet = result.items[0];
  } catch (error) {
    if (error instanceof UsfError) throw error;
    const reasonCode = error instanceof Error ? error.message : "GRAPH_LOAD_FAILED";
    return fail("CALL_LEAF_SCOPE_REFUSED", exitCodes.CURRENTNESS_FAILURE, "The exact current graph call leaf authority could not be derived.", { reasonCode });
  }
  const stage = packet.realisationStage;
  if (stage?.stage !== "verified-complete" || stage.completion.verified !== true || stage.completion.proofResult == null) {
    return fail("CALL_LEAF_PROOFBLOCKED", exitCodes.DOMAIN_FAILURE, "The graph call leaf remains proofblocked until its exact current file-based completion is independently verified and published.", {
      ownerWork,
      capabilityStage: stage?.stage ?? "unknown",
      completionReasonCodes: stage?.completion.reasonCodes ?? [],
    });
  }
  const projectedBasis = packet.realisationBasis;
  if (projectedBasis === undefined) {
    return fail("CALL_LEAF_BASIS_REFUSED", exitCodes.CURRENTNESS_FAILURE, "The graph call leaf has no projected realisation basis.");
  }
  let currentBasis: RealisationBasis;
  try {
    const assertRealisationBasis: (value: unknown) => asserts value is RealisationBasis = basisModule.assertRealisationBasis;
    assertRealisationBasis(projectedBasis);
    basisModule.assertBasisMatchesPacket(projectedBasis, packet);
    currentBasis = await workModule.deriveCurrentRealisationBasis(request.repositoryRoot, projectedBasis);
    basisModule.assertBasisMatchesPacket(currentBasis, packet);
    basisModule.assertSameBasis(projectedBasis, currentBasis);
  } catch (error) {
    const reasonCode = error instanceof Error ? error.message : "BASIS_CURRENTNESS_FAILED";
    return fail("CALL_LEAF_BASIS_REFUSED", exitCodes.CURRENTNESS_FAILURE, "The graph call leaf basis is not exact and current.", { reasonCode });
  }
  const repositoryDependencies = deriveRepositoryLeafDependencies(packet, {
    ownerWork,
    entryModulePath,
    reasonCode: "CALL_LEAF_DEPENDENCY_REFUSED",
  });
  const moduleDependency = repositoryDependencies.find((dependency) => dependency.path === entryModulePath);
  if (moduleDependency === undefined || !digestPattern.test(packet.scopedDependencyDigest)) {
    return fail("CALL_LEAF_DEPENDENCY_REFUSED", exitCodes.CURRENTNESS_FAILURE, "The graph call leaf module or scoped dependency identity is unavailable.");
  }
  return Object.freeze({
    leaf: request.leaf,
    work: ownerWork,
    contract: ownerContract,
    profile,
    manifest,
    repositoryRoot: request.repositoryRoot,
    basisDigest: currentBasis.basisDigest,
    scopedDependencyDigest: packet.scopedDependencyDigest,
    modulePath: entryModulePath,
    moduleDigest: moduleDependency.digest,
    repositoryDependencies,
    repositoryClosureDigest: canonicalDigest(repositoryDependencies),
  });
}

function expectedGraphAuthority(authorization: GraphLeafAuthorization, childEntry: FreshLeafChildEntryAuthority): FreshLeafExpectedAuthority {
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

function sameGraphAuthority(left: FreshLeafExpectedAuthority, right: FreshLeafExpectedAuthority): boolean {
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

function validateGraphAuthorization(
  authorization: GraphLeafAuthorization,
  leaf: GraphLeafName,
  parsed: GraphLeafScope,
  repositoryRoot: string,
  expected?: FreshLeafExpectedAuthority,
): readonly RepositoryLeafDependency[] {
  if (authorization.leaf !== leaf
    || authorization.work !== ownerWork
    || authorization.contract !== ownerContract
    || authorization.profile !== parsed.profile
    || authorization.manifest !== parsed.manifest
    || authorization.repositoryRoot !== repositoryRoot
    || authorization.modulePath !== entryModulePath
    || !digestPattern.test(authorization.basisDigest)
    || !digestPattern.test(authorization.scopedDependencyDigest)
    || !digestPattern.test(authorization.moduleDigest)) {
    return fail("CALL_LEAF_SCOPE_REFUSED", exitCodes.CURRENTNESS_FAILURE, "The graph leaf authorization does not bind the exact selected scope, owner, basis and module.");
  }
  const repositoryDependencies = exactTicketDependencies(authorization);
  if (expected !== undefined && !sameGraphAuthority(expectedGraphAuthority(authorization, expected.childEntry), expected)) {
    return fail("CALL_LEAF_DEPENDENCY_REFUSED", exitCodes.CURRENTNESS_FAILURE, "The child re-admission does not match the parent-admitted graph leaf authority identity.");
  }
  return repositoryDependencies;
}

async function requireGraphImplementationRoot(repositoryRoot: string): Promise<void> {
  try {
    const selectedRoot = await realpath(repositoryRoot);
    if (selectedRoot !== await realpath(implementationRoot)) {
      return fail("CALL_LEAF_ROOT_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "Graph leaf authority and implementation must share one repository root.");
    }
  } catch (error) {
    if (error instanceof UsfError) throw error;
    return fail("CALL_LEAF_ROOT_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The graph leaf implementation root could not be authenticated.");
  }
}

async function prepareGraphLeafChild(
  leaf: GraphLeafName,
  leafArgs: readonly string[],
  repositoryRoot: string,
  expected: FreshLeafExpectedAuthority,
  dependencies: {
    readonly authorize: GraphLeafAuthorizer;
    readonly authenticate: (repositoryRoot: string, dependencies: readonly RepositoryLeafDependency[], reasonCode: string) => Promise<void>;
    readonly load: GraphLeafLoader;
    readonly withImportLock: ProviderLeafImportLock;
    readonly authorizeChildEntry: FreshLeafChildEntryAuthorizer;
    readonly authenticateChildEntry: typeof authenticateFreshLeafChildEntry;
  },
): Promise<CommandHandler> {
  const parsed = parseGraphLeafScope(leafArgs);
  return dependencies.withImportLock(repositoryRoot, async () => {
    const childEntry = await dependencies.authorizeChildEntry({
      repositoryRoot,
      profile: expected.profile,
      manifest: expected.manifest,
      featureWork: ownerWork,
      path: "src/commands/graph-leaf-dispatch.ts",
    });
    if (canonicalDigest(childEntry) !== canonicalDigest(expected.childEntry)) {
      return fail("CALL_LEAF_DEPENDENCY_REFUSED", exitCodes.CURRENTNESS_FAILURE, "The child re-admission does not match the parent-admitted graph child entry.");
    }
    await dependencies.authenticateChildEntry(repositoryRoot, childEntry);
    const authorization = await dependencies.authorize(Object.freeze({ leaf, args: leafArgs, repositoryRoot }));
    const repositoryDependencies = validateGraphAuthorization(authorization, leaf, parsed, repositoryRoot, expected);
    await dependencies.authenticate(repositoryRoot, repositoryDependencies, "CALL_LEAF_DEPENDENCY_REFUSED");
    const moduleUrl = pathToFileURL(resolve(repositoryRoot, entryModulePath)).href;
    let loaded: Record<string, unknown>;
    try {
      const candidate = await dependencies.load(moduleUrl);
      if (!isRecord(candidate)) return fail("CALL_LEAF_UNAVAILABLE", exitCodes.CURRENTNESS_FAILURE, "The authorized graph leaf module is not a module namespace.");
      loaded = candidate;
    } catch (error) {
      const code = isRecord(error) && typeof error.code === "string" ? error.code : undefined;
      const missingUrl = isRecord(error) && typeof error.url === "string" ? error.url : undefined;
      if (code === "ERR_MODULE_NOT_FOUND" && missingUrl === moduleUrl) {
        return fail("CALL_LEAF_PROOFBLOCKED", exitCodes.DOMAIN_FAILURE, "The graph call leaf implementation is not present under completed authority.");
      }
      throw error;
    }
    const selected = loaded[definitions[leaf].handlerExport];
    if (typeof selected !== "function") return fail("CALL_LEAF_UNAVAILABLE", exitCodes.CURRENTNESS_FAILURE, "The authorized graph leaf module does not expose its reserved handler.");
    const moduleDependency = repositoryDependencies.find((dependency) => dependency.path === entryModulePath)!;
    await dependencies.authenticate(repositoryRoot, Object.freeze([moduleDependency]), "CALL_LEAF_DEPENDENCY_REFUSED");
    await dependencies.authenticateChildEntry(repositoryRoot, childEntry);
    return selected as CommandHandler;
  });
}

export async function prepareCurrentGraphLeafChild(request: FreshLeafWireRequest): Promise<CommandHandler> {
  if (request.family !== "call" || (request.leaf !== "parallel" && request.leaf !== "compare")) {
    return fail("CALL_LEAF_CHILD_REQUEST_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The fresh graph child request does not select a registered graph leaf.");
  }
  await requireGraphImplementationRoot(request.repositoryRoot);
  return prepareGraphLeafChild(request.leaf, request.args, request.repositoryRoot, request.expected, {
    authorize: authorizeCurrentGraphLeaf,
    authenticate: authenticateRepositoryLeafDependencies,
    load: (specifier) => import(specifier),
    withImportLock: withSharedPrimaryMutationLock,
    authorizeChildEntry: authorizeCurrentFreshLeafChildEntry,
    authenticateChildEntry: authenticateFreshLeafChildEntry,
  });
}

export function createGraphLeafDispatcher(dependencies: {
  readonly authorize?: GraphLeafAuthorizer;
  readonly authenticate?: (repositoryRoot: string, dependencies: readonly RepositoryLeafDependency[], reasonCode: string) => Promise<void>;
  readonly load?: GraphLeafLoader;
  readonly withImportLock?: ProviderLeafImportLock;
  readonly launcherLock?: (repositoryRoot: string, family: FreshLeafFamily, leaf: string) => Promise<FreshLeafLauncherLock>;
  readonly runChild?: FreshLeafChildRunner;
  readonly authorizeChildEntry?: FreshLeafChildEntryAuthorizer;
  readonly authenticateChildEntry?: typeof authenticateFreshLeafChildEntry;
} = {}): (args: readonly string[], repositoryRoot: string) => Promise<CommandResult | null> {
  const authorize = dependencies.authorize ?? authorizeCurrentGraphLeaf;
  const authenticate = dependencies.authenticate ?? authenticateRepositoryLeafDependencies;
  const load = dependencies.load ?? ((specifier: string) => import(specifier));
  const withImportLock = dependencies.withImportLock ?? withSharedPrimaryMutationLock;
  const getLauncherLock = dependencies.launcherLock ?? inheritedLauncherLock;
  const authorizeChildEntry = dependencies.authorizeChildEntry ?? authorizeCurrentFreshLeafChildEntry;
  const authenticateChildEntry = dependencies.authenticateChildEntry ?? authenticateFreshLeafChildEntry;
  const runChild: FreshLeafChildRunner = dependencies.runChild ?? ((invocation) => invokeFreshLeafChildProcess(
    invocation.request,
    invocation.validateParentLock,
    invocation.releaseParentLock,
    fileURLToPath(import.meta.url),
  ));
  return async (args, repositoryRoot) => {
    const leaf = args[0];
    if (leaf !== "parallel" && leaf !== "compare") return null;
    const leafArgs = args.slice(1);
    const parsed = parseGraphLeafScope(leafArgs);
    await requireGraphImplementationRoot(repositoryRoot);
    const launcherLock = await getLauncherLock(repositoryRoot, "call", leaf);
    let released = false;
    const releaseParentLock = async (): Promise<void> => {
      if (released) return;
      released = true;
      await launcherLock.release();
    };
    try {
      await launcherLock.validate();
      const authorization = await authorize(Object.freeze({ leaf, args: leafArgs, repositoryRoot }));
      const repositoryDependencies = validateGraphAuthorization(authorization, leaf, parsed, repositoryRoot);
      const childEntry = await authorizeChildEntry({
        repositoryRoot,
        profile: authorization.profile,
        manifest: authorization.manifest,
        featureWork: authorization.work,
        path: "src/commands/graph-leaf-dispatch.ts",
      });
      await authenticateChildEntry(repositoryRoot, childEntry);
      await authenticate(repositoryRoot, repositoryDependencies, "CALL_LEAF_DEPENDENCY_REFUSED");
      const moduleDependency = repositoryDependencies.find((dependency) => dependency.path === entryModulePath)!;
      await authenticate(repositoryRoot, Object.freeze([moduleDependency]), "CALL_LEAF_DEPENDENCY_REFUSED");
      await launcherLock.validate();
      const expected = expectedGraphAuthority(authorization, childEntry);
      return await runChild(Object.freeze({
        request: Object.freeze({
          schema: "urn:usf:dynamic-leaf-child-request:1",
          family: "call",
          leaf,
          args: Object.freeze([...leafArgs]),
          repositoryRoot,
          expected,
        }),
        prepareChild: async () => prepareGraphLeafChild(leaf, leafArgs, repositoryRoot, expected, { authorize, authenticate, load, withImportLock, authorizeChildEntry, authenticateChildEntry }),
        validateParentLock: launcherLock.validate,
        releaseParentLock,
      }));
    } finally {
      await releaseParentLock();
    }
  };
}

export const dispatchRegisteredGraphLeaf = createGraphLeafDispatcher();

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv[2] === "--usf-dynamic-leaf-child") {
  void runDynamicLeafChild().then(
    () => process.exit(0),
    () => process.exit(1),
  );
}
