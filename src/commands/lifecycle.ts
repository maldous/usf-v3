import { execFileSync } from "node:child_process";
import { constants, realpathSync } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { canonicalDigest, canonicalJson, sha256 } from "../core/canonical.ts";
import { exitCodes, type ExitCode, UsfError } from "../core/errors.ts";
import { loadSemanticGraph } from "../graph/index.ts";
import { deriveWork } from "../graph/work.ts";
import {
  createLifecycleBinding,
  lifecycleNonclaims,
  linuxProcessInspector,
  observeLifecycleStatus,
  randomLifecycleIds,
  requestLifecycleStop,
  runForegroundLifecycle,
  systemLifecycleClock,
  validateInstanceSlug,
  validateRepositoryManifest,
  validateVersionedProfile,
  type ForegroundLifecycleResult,
  type LifecycleBinding,
  type LifecycleCarrier,
  type LifecycleClock,
  type LifecycleCycle,
  type LifecycleEventEmitter,
  type LifecycleIdGenerator,
  type LifecycleThrough,
  type ProcessInspector,
} from "../continuous/lifecycle.ts";
import type { CommandHandler, CommandResult } from "./dispatcher.ts";

export interface AutomationPolicy {
  readonly $schema: "urn:usf:automation:1";
  readonly defaultThrough: LifecycleThrough;
  readonly allowAutomaticIntegration: boolean;
  readonly allowAutomaticPublication: boolean;
  readonly hostConcurrencyCap: number;
}

export interface LifecycleProfileObservation {
  readonly binding: LifecycleBinding;
  readonly carrier: LifecycleCarrier;
}

export const lifecycleCommandReasonCodes = Object.freeze({
  ARGUMENTS_INVALID: "LIFECYCLE_ARGUMENTS_INVALID",
  PROFILE_REQUIRED: "LIFECYCLE_PROFILE_REQUIRED",
  MANIFEST_REQUIRED: "LIFECYCLE_MANIFEST_REQUIRED",
  AUTOMATION_INVALID: "LIFECYCLE_AUTOMATION_INVALID",
  AUTOMATION_UNREADABLE: "LIFECYCLE_AUTOMATION_UNREADABLE",
  AUTOMATION_INTEGRATION_REFUSED: "LIFECYCLE_AUTOMATIC_INTEGRATION_REFUSED",
  AUTOMATION_PUBLICATION_REFUSED: "LIFECYCLE_AUTOMATIC_PUBLICATION_REFUSED",
  PROFILE_REFUSED: "LIFECYCLE_PROFILE_REFUSED",
  PROFILE_TOO_LARGE: "LIFECYCLE_PROFILE_TOO_LARGE",
  CARRIER_UNAVAILABLE: "LIFECYCLE_CARRIER_UNAVAILABLE",
} as const);

const automationPath = "config/automation.json";
const maximumAutomationBytes = 16 * 1024;
const defaultInstance = "default";
const defaultStopWaitMs = 5_000;
const digestPattern = /^sha256:[0-9a-f]{64}$/;
const lifecycleToolPaths = Object.freeze([
  "bin/usf",
  "src/cli.ts",
  "src/commands/lifecycle.ts",
  "src/continuous/lifecycle.ts",
] as const);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function asLifecycleError(error: unknown, fallbackCode: string, fallbackExit: ExitCode): UsfError {
  return error instanceof UsfError
    ? error
    : new UsfError(fallbackCode, fallbackExit, "The lifecycle command failed closed.");
}

async function readBoundedTrackedFile(repositoryRoot: string, repositoryPath: string, maximumBytes: number): Promise<string> {
  const root = realpathSync(resolve(repositoryRoot));
  const absolute = resolve(root, repositoryPath);
  const relation = relative(root, absolute);
  if (relation === "" || relation === ".." || relation.startsWith(`..${sep}`)) {
    throw new UsfError(lifecycleCommandReasonCodes.AUTOMATION_UNREADABLE, exitCodes.CONTAINMENT_REFUSAL, "The automation policy path escapes the repository.");
  }
  let parent = root;
  for (const segment of repositoryPath.split("/").slice(0, -1)) {
    parent = resolve(parent, segment);
    let parentMetadata;
    try { parentMetadata = await lstat(parent); }
    catch { throw new UsfError(lifecycleCommandReasonCodes.AUTOMATION_UNREADABLE, exitCodes.INVALID_INPUT, "A tracked automation policy directory is unreadable."); }
    if (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink()) {
      throw new UsfError(lifecycleCommandReasonCodes.AUTOMATION_UNREADABLE, exitCodes.CONTAINMENT_REFUSAL, "Tracked automation policy directory symlinks are forbidden.");
    }
  }
  let metadata;
  try { metadata = await lstat(absolute); }
  catch { throw new UsfError(lifecycleCommandReasonCodes.AUTOMATION_UNREADABLE, exitCodes.INVALID_INPUT, "The tracked automation policy is unreadable."); }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 2 || metadata.size > maximumBytes) {
    throw new UsfError(lifecycleCommandReasonCodes.AUTOMATION_UNREADABLE, exitCodes.CONTAINMENT_REFUSAL, "The tracked automation policy is not a bounded regular file.");
  }
  let canonical;
  try { canonical = await realpath(absolute); }
  catch { throw new UsfError(lifecycleCommandReasonCodes.AUTOMATION_UNREADABLE, exitCodes.CONTAINMENT_REFUSAL, "The tracked automation policy cannot be resolved safely."); }
  const canonicalRelation = relative(root, canonical);
  if (canonicalRelation === "" || canonicalRelation === ".." || canonicalRelation.startsWith(`..${sep}`)) {
    throw new UsfError(lifecycleCommandReasonCodes.AUTOMATION_UNREADABLE, exitCodes.CONTAINMENT_REFUSAL, "The tracked automation policy resolves outside the repository.");
  }
  let handle;
  try {
    handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== metadata.dev || opened.ino !== metadata.ino || opened.size !== metadata.size) {
      throw new UsfError(lifecycleCommandReasonCodes.AUTOMATION_UNREADABLE, exitCodes.CONTAINMENT_REFUSAL, "The tracked automation policy changed while being opened.");
    }
    return await handle.readFile("utf8");
  } finally {
    await handle?.close();
  }
}

export async function loadAutomationPolicy(repositoryRoot: string): Promise<AutomationPolicy> {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", "--", automationPath], {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "ignore", "ignore"],
    });
  } catch {
    throw new UsfError(lifecycleCommandReasonCodes.AUTOMATION_UNREADABLE, exitCodes.CURRENTNESS_FAILURE, "The automation policy must be a tracked repository file.");
  }
  const content = await readBoundedTrackedFile(repositoryRoot, automationPath, maximumAutomationBytes);
  let value: unknown;
  try { value = JSON.parse(content); }
  catch { throw new UsfError(lifecycleCommandReasonCodes.AUTOMATION_INVALID, exitCodes.INVALID_INPUT, "The tracked automation policy is not valid JSON."); }
  if (!isRecord(value)
    || !exactKeys(value, ["$schema", "defaultThrough", "allowAutomaticIntegration", "allowAutomaticPublication", "hostConcurrencyCap"])
    || value.$schema !== "urn:usf:automation:1"
    || !["check", "integrate", "publish"].includes(String(value.defaultThrough))
    || typeof value.allowAutomaticIntegration !== "boolean"
    || typeof value.allowAutomaticPublication !== "boolean"
    || !Number.isSafeInteger(value.hostConcurrencyCap)
    || Number(value.hostConcurrencyCap) < 1
    || Number(value.hostConcurrencyCap) > 256) {
    throw new UsfError(lifecycleCommandReasonCodes.AUTOMATION_INVALID, exitCodes.INVALID_INPUT, "The tracked automation policy does not satisfy its closed lifecycle schema.");
  }
  return Object.freeze(value as unknown as AutomationPolicy);
}

export function enforceAutomationThrough(policy: AutomationPolicy, through: LifecycleThrough): void {
  if (through === "integrate" && !policy.allowAutomaticIntegration) {
    throw new UsfError(lifecycleCommandReasonCodes.AUTOMATION_INTEGRATION_REFUSED, exitCodes.DOMAIN_FAILURE, "Tracked policy does not permit unattended integration.");
  }
  if (through === "publish" && (!policy.allowAutomaticIntegration || !policy.allowAutomaticPublication)) {
    throw new UsfError(lifecycleCommandReasonCodes.AUTOMATION_PUBLICATION_REFUSED, exitCodes.DOMAIN_FAILURE, "Tracked policy does not permit unattended integration and publication.");
  }
}

export function observeCarrier(repositoryRoot: string): LifecycleCarrier {
  try {
    const commit = execFileSync("git", ["rev-parse", "HEAD^{commit}"], { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const tree = execFileSync("git", ["rev-parse", `${commit}^{tree}`], { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(commit) || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(tree)) throw new Error("invalid-object-id");
    return Object.freeze({ commit, tree });
  } catch {
    throw new UsfError(lifecycleCommandReasonCodes.CARRIER_UNAVAILABLE, exitCodes.CURRENTNESS_FAILURE, "The initial Git carrier commit and tree are unavailable.");
  }
}

export async function observeLifecycleToolDigest(repositoryRoot: string): Promise<`sha256:${string}`> {
  try {
    const assets = await Promise.all(lifecycleToolPaths.map(async (path) => ({
      path,
      digest: sha256(await readBoundedTrackedFile(repositoryRoot, path, 1024 * 1024)),
    })));
    return canonicalDigest(assets, { rejectAbsolutePaths: true });
  } catch {
    throw new UsfError(lifecycleCommandReasonCodes.PROFILE_REFUSED, exitCodes.CURRENTNESS_FAILURE, "The repository-contained lifecycle tool identity is unavailable.");
  }
}

export async function buildLifecycleProfileObservation(input: {
  readonly repositoryRoot: string;
  readonly profile: string;
  readonly manifest: string;
  readonly through?: LifecycleThrough;
}): Promise<LifecycleProfileObservation> {
  const profile = validateVersionedProfile(input.profile);
  const manifest = validateRepositoryManifest(input.manifest);
  const policy = await loadAutomationPolicy(input.repositoryRoot);
  const through = input.through ?? policy.defaultThrough;
  enforceAutomationThrough(policy, through);
  let graph;
  try { graph = loadSemanticGraph(input.repositoryRoot, manifest); }
  catch {
    throw new UsfError(lifecycleCommandReasonCodes.PROFILE_REFUSED, exitCodes.CURRENTNESS_FAILURE, "The selected graph manifest could not produce a current profile observation.");
  }
  let work;
  try { work = deriveWork(graph, { selector: `profile:${profile}`, maxItems: 100 }); }
  catch {
    throw new UsfError(lifecycleCommandReasonCodes.PROFILE_REFUSED, exitCodes.CURRENTNESS_FAILURE, "The selected profile could not produce a valid scoped work projection.");
  }
  if (work.status !== "ok" || work.items === undefined || work.semanticDigest === undefined) {
    throw new UsfError(lifecycleCommandReasonCodes.PROFILE_REFUSED, exitCodes.CURRENTNESS_FAILURE, "The selected profile is unknown or invalid.");
  }
  if (work.truncation?.truncated) {
    throw new UsfError(lifecycleCommandReasonCodes.PROFILE_TOO_LARGE, exitCodes.CURRENTNESS_FAILURE, "The selected profile exceeds the bounded lifecycle work projection.");
  }
  const scopedDependencyDigests = work.items.map((packet) => ({ workId: packet.id, digest: packet.scopedDependencyDigest as `sha256:${string}` }))
    .sort((left, right) => left.workId.localeCompare(right.workId));
  if (!digestPattern.test(work.semanticDigest) || scopedDependencyDigests.some((dependency) => !digestPattern.test(dependency.digest))) {
    throw new UsfError(lifecycleCommandReasonCodes.PROFILE_REFUSED, exitCodes.CURRENTNESS_FAILURE, "The selected profile produced malformed dependency observations.");
  }
  return Object.freeze({
    binding: createLifecycleBinding({
      profile,
      manifest,
      through,
      automationPolicyDigest: canonicalDigest(policy, { rejectAbsolutePaths: true }),
      lifecycleToolDigest: await observeLifecycleToolDigest(input.repositoryRoot),
      graphSemanticDigest: work.semanticDigest as `sha256:${string}`,
      scopedDependencyDigests,
    }),
    carrier: observeCarrier(input.repositoryRoot),
  });
}

interface ForegroundArguments {
  readonly profile: string;
  readonly manifest: string;
  readonly through?: LifecycleThrough;
  readonly instance: string;
}

function parseFlagPairs(args: readonly string[], allowed: readonly string[]): Map<string, string> | undefined {
  if (args.length % 2 !== 0) return undefined;
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index]!;
    const value = args[index + 1]!;
    if (!allowed.includes(option) || values.has(option) || value.length === 0 || value.startsWith("--")) return undefined;
    values.set(option, value);
  }
  return values;
}

function parseForegroundArguments(args: readonly string[]): ForegroundArguments {
  const values = parseFlagPairs(args, ["--profile", "--manifest", "--through", "--instance"]);
  if (values === undefined) throw new UsfError(lifecycleCommandReasonCodes.ARGUMENTS_INVALID, exitCodes.INVALID_INPUT, "Lifecycle start/watch arguments are invalid.");
  const profile = values.get("--profile");
  if (profile === undefined) throw new UsfError(lifecycleCommandReasonCodes.PROFILE_REQUIRED, exitCodes.INVALID_INPUT, "Lifecycle start/watch requires --profile with an explicitly versioned URN.");
  const manifest = values.get("--manifest");
  if (manifest === undefined) throw new UsfError(lifecycleCommandReasonCodes.MANIFEST_REQUIRED, exitCodes.INVALID_INPUT, "Lifecycle start/watch requires an explicit repository-relative --manifest; no product overlay is selected implicitly.");
  const throughValue = values.get("--through");
  if (throughValue !== undefined && !["check", "integrate", "publish"].includes(throughValue)) {
    throw new UsfError(lifecycleCommandReasonCodes.ARGUMENTS_INVALID, exitCodes.INVALID_INPUT, "Lifecycle --through must be check, integrate, or publish.");
  }
  return {
    profile: validateVersionedProfile(profile),
    manifest: validateRepositoryManifest(manifest),
    through: throughValue as LifecycleThrough | undefined,
    instance: validateInstanceSlug(values.get("--instance") ?? defaultInstance),
  };
}

function parseInstanceArguments(args: readonly string[], allowWait: boolean): { instance: string; waitMs: number } {
  const values = parseFlagPairs(args, allowWait ? ["--instance", "--wait-ms"] : ["--instance"]);
  if (values === undefined) throw new UsfError(lifecycleCommandReasonCodes.ARGUMENTS_INVALID, exitCodes.INVALID_INPUT, "Lifecycle instance arguments are invalid.");
  const waitValue = values.get("--wait-ms");
  if (!allowWait && waitValue !== undefined) throw new UsfError(lifecycleCommandReasonCodes.ARGUMENTS_INVALID, exitCodes.INVALID_INPUT, "Lifecycle status does not accept a wait bound.");
  if (waitValue !== undefined && !/^(?:0|[1-9][0-9]{0,5})$/.test(waitValue)) {
    throw new UsfError(lifecycleCommandReasonCodes.ARGUMENTS_INVALID, exitCodes.INVALID_INPUT, "Lifecycle --wait-ms must be a bounded decimal integer.");
  }
  const waitMs = waitValue === undefined ? defaultStopWaitMs : Number(waitValue);
  if (waitMs > 600_000) throw new UsfError(lifecycleCommandReasonCodes.ARGUMENTS_INVALID, exitCodes.INVALID_INPUT, "Lifecycle --wait-ms exceeds 600000 milliseconds.");
  return { instance: validateInstanceSlug(values.get("--instance") ?? defaultInstance), waitMs };
}

export interface LifecycleCommandDependencies {
  readonly processInspector: ProcessInspector;
  readonly clock: LifecycleClock;
  readonly ids: LifecycleIdGenerator;
  readonly emit: LifecycleEventEmitter;
  readonly buildObservation: typeof buildLifecycleProfileObservation;
  readonly cycleFactory?: (input: { readonly repositoryRoot: string; readonly profile: string; readonly manifest: string; readonly through: LifecycleThrough }) => LifecycleCycle;
  readonly installSignalHandlers?: boolean;
}

function jsonlEmitter(event: Readonly<Record<string, unknown>>): void {
  process.stdout.write(`${canonicalJson(event, { rejectAbsolutePaths: true })}\n`);
}

const defaultDependencies: LifecycleCommandDependencies = Object.freeze({
  processInspector: linuxProcessInspector,
  clock: systemLifecycleClock,
  ids: randomLifecycleIds,
  emit: jsonlEmitter,
  buildObservation: buildLifecycleProfileObservation,
  installSignalHandlers: true,
});

function refusal(command: "start" | "watch" | "stop" | "status", error: unknown): CommandResult {
  const failure = asLifecycleError(error, "LIFECYCLE_INTERNAL_REFUSAL", exitCodes.DOMAIN_FAILURE);
  return {
    output: { schema: "urn:usf:lifecycle-command-result:1", command, status: "refused", reasonCode: failure.code, nonclaims: lifecycleNonclaims },
    exitCode: failure.exitCode,
  };
}

function exitForForeground(result: ForegroundLifecycleResult): ExitCode {
  return result.status === "degraded" ? exitCodes.CONTINUOUS_DEGRADED : exitCodes.SUCCESS;
}

function createForegroundHandler(command: "start" | "watch", dependencies: LifecycleCommandDependencies): CommandHandler {
  return async ({ args, repositoryRoot }) => {
    try {
      const parsed = parseForegroundArguments(args);
      const initial = await dependencies.buildObservation({ repositoryRoot, profile: parsed.profile, manifest: parsed.manifest, through: parsed.through });
      const through = initial.binding.through;
      const cycle = dependencies.cycleFactory?.({ repositoryRoot, profile: parsed.profile, manifest: parsed.manifest, through }) ?? (async () => {
        const current = await dependencies.buildObservation({ repositoryRoot, profile: parsed.profile, manifest: parsed.manifest, through });
        return { state: "idle" as const, binding: current.binding };
      });
      const result = await runForegroundLifecycle({
        command,
        repositoryRoot,
        instance: parsed.instance,
        binding: initial.binding,
        initialCarrier: initial.carrier,
        cycle,
        emit: dependencies.emit,
        processInspector: dependencies.processInspector,
        clock: dependencies.clock,
        ids: dependencies.ids,
        installSignalHandlers: dependencies.installSignalHandlers,
      });
      // Foreground lifecycle output is JSONL emitted as events.  Returning it
      // again would duplicate the terminal record in the top-level dispatcher.
      return { output: undefined, exitCode: exitForForeground(result) };
    } catch (error) { return refusal(command, error); }
  };
}

export function createLifecycleCommandHandlers(overrides: Partial<LifecycleCommandDependencies> = {}): {
  readonly watchCommandHandler: CommandHandler;
  readonly startCommandHandler: CommandHandler;
  readonly stopCommandHandler: CommandHandler;
  readonly statusCommandHandler: CommandHandler;
} {
  const dependencies: LifecycleCommandDependencies = Object.freeze({ ...defaultDependencies, ...overrides });
  const stopCommandHandler: CommandHandler = async ({ args, repositoryRoot }) => {
    try {
      const parsed = parseInstanceArguments(args, true);
      const result = await requestLifecycleStop({ repositoryRoot, instance: parsed.instance, waitMs: parsed.waitMs, processInspector: dependencies.processInspector, clock: dependencies.clock, ids: dependencies.ids });
      return { output: result, exitCode: result.status === "degraded" ? exitCodes.CONTINUOUS_DEGRADED : exitCodes.SUCCESS };
    } catch (error) { return refusal("stop", error); }
  };
  const statusCommandHandler: CommandHandler = async ({ args, repositoryRoot }) => {
    try {
      const parsed = parseInstanceArguments(args, false);
      return { output: await observeLifecycleStatus(repositoryRoot, parsed.instance, dependencies.processInspector), exitCode: exitCodes.SUCCESS };
    } catch (error) { return refusal("status", error); }
  };
  return Object.freeze({
    watchCommandHandler: createForegroundHandler("watch", dependencies),
    startCommandHandler: createForegroundHandler("start", dependencies),
    stopCommandHandler,
    statusCommandHandler,
  });
}

const lifecycleHandlers = createLifecycleCommandHandlers();
export const watchCommandHandler = lifecycleHandlers.watchCommandHandler;
export const startCommandHandler = lifecycleHandlers.startCommandHandler;
export const stopCommandHandler = lifecycleHandlers.stopCommandHandler;
export const statusCommandHandler = lifecycleHandlers.statusCommandHandler;
