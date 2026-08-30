import { execFileSync, spawnSync } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { exitCodes, UsfError } from "../core/errors.ts";
import { observeLifecycleStatus, validateInstanceSlug, validateRepositoryManifest, validateVersionedProfile } from "../continuous/lifecycle.ts";
import { loadSemanticGraph } from "../graph/index.ts";
import { deriveWork } from "../graph/work.ts";
import type { CommandHandler } from "./dispatcher.ts";

const statusNonclaims = Object.freeze([
  "status-is-observation-not-semantic-authority",
  "configured-route-count-is-not-live-provider-eligibility",
  "lifecycle-running-is-not-work-completion-or-proof",
  "unobserved-values-are-not-zero",
  "no-full-anqr-staging-production-or-terminal-proof-claim",
] as const);

interface StatusArguments {
  readonly instance: string;
  readonly profile?: string;
  readonly manifest?: string;
  readonly detail: "summary" | "full";
  readonly maxItems: number;
}

function parseStatusArguments(args: readonly string[]): StatusArguments {
  if (args.length % 2 !== 0) throw new UsfError("STATUS_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, "Status options require explicit values.");
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index]!;
    const value = args[index + 1]!;
    if (!['--instance', '--profile', '--manifest', '--detail', '--max-items'].includes(option) || values.has(option) || value.length === 0 || value.startsWith("--")) {
      throw new UsfError("STATUS_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, "Status options are invalid or duplicated.");
    }
    values.set(option, value);
  }
  const profile = values.get("--profile");
  const manifest = values.get("--manifest");
  if ((profile === undefined) !== (manifest === undefined)) {
    throw new UsfError("STATUS_SCOPE_INCOMPLETE", exitCodes.INVALID_INPUT, "Semantic status requires both --profile and --manifest; no product overlay is selected implicitly.");
  }
  const detail = values.get("--detail") ?? "summary";
  if (detail !== "summary" && detail !== "full") throw new UsfError("STATUS_DETAIL_INVALID", exitCodes.INVALID_INPUT, "Status detail must be summary or full.");
  const maxValue = values.get("--max-items") ?? "100";
  if (!/^[1-9][0-9]{0,3}$/.test(maxValue) || Number(maxValue) > 1_000) throw new UsfError("STATUS_MAX_ITEMS_INVALID", exitCodes.INVALID_INPUT, "Status max items must be an integer from 1 through 1000.");
  return Object.freeze({
    instance: validateInstanceSlug(values.get("--instance") ?? "default"),
    ...(profile === undefined ? {} : { profile: validateVersionedProfile(profile), manifest: validateRepositoryManifest(manifest!) }),
    detail,
    maxItems: Number(maxValue),
  });
}

function repositoryObservation(repositoryRoot: string): Readonly<Record<string, unknown>> {
  try {
    const commit = execFileSync("git", ["rev-parse", "HEAD^{commit}"], { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const tree = execFileSync("git", ["rev-parse", `${commit}^{tree}`], { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const dirty = spawnSync("git", ["diff-index", "--quiet", "HEAD", "--"], { cwd: repositoryRoot, stdio: "ignore" });
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(commit) || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(tree) || ![0, 1].includes(dirty.status ?? -1)) throw new Error("repository-observation-invalid");
    return Object.freeze({ status: "observed", commit, tree, trackedTreeClean: dirty.status === 0, remoteContact: false });
  } catch {
    throw new UsfError("STATUS_REPOSITORY_UNAVAILABLE", exitCodes.CURRENTNESS_FAILURE, "Local Git carrier status is unavailable.");
  }
}

async function providerObservation(repositoryRoot: string): Promise<Readonly<Record<string, unknown>>> {
  const path = resolve(repositoryRoot, "config/providers.json");
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 2 || metadata.size > 64 * 1024) {
    throw new UsfError("STATUS_PROVIDERS_INVALID", exitCodes.CONTAINMENT_REFUSAL, "The configured provider source is not a bounded regular file.");
  }
  let value: unknown;
  try { value = JSON.parse(await readFile(path, "utf8")); }
  catch { throw new UsfError("STATUS_PROVIDERS_INVALID", exitCodes.INVALID_INPUT, "The configured provider source is invalid JSON."); }
  if (typeof value !== "object" || value === null || Array.isArray(value)
    || (value as Record<string, unknown>).$schema !== "urn:usf:providers:1"
    || (value as Record<string, unknown>).catalogueSource !== "models.dev"
    || !Array.isArray((value as Record<string, unknown>).routes)) {
    throw new UsfError("STATUS_PROVIDERS_INVALID", exitCodes.INVALID_INPUT, "The configured provider source does not satisfy its bootstrap shape.");
  }
  const configuredRoutes = ((value as Record<string, unknown>).routes as unknown[]).length;
  return Object.freeze({
    status: "observed",
    configuredRoutes,
    configuredRoutesDenominator: "entries-in-config/providers.json",
    configuredProviderCount: null,
    actualProviderCount: null,
    actualModelCount: null,
    eligibility: "not-probed",
    reasonCode: configuredRoutes === 0 ? "PROVIDER_ROUTES_EMPTY" : "PROVIDER_IDENTITY_CENSUS_NOT_IMPLEMENTED",
    remoteContact: false,
  });
}

async function metricsSourceObservation(repositoryRoot: string): Promise<Readonly<Record<string, unknown>>> {
  const path = resolve(repositoryRoot, ".usf/metrics/events.jsonl");
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) return Object.freeze({ status: "refused", source: ".usf/metrics/events.jsonl", reasonCode: "METRICS_SOURCE_UNSAFE" });
    return Object.freeze({ status: "available", source: ".usf/metrics/events.jsonl", bytes: metadata.size, aggregation: "run-usf-metrics", historyScanned: false });
  } catch (error) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return Object.freeze({ status: "not-observed", source: ".usf/metrics/events.jsonl", reasonCode: "METRICS_SOURCE_MISSING", historyScanned: false });
    }
    throw error;
  }
}

function semanticObservation(repositoryRoot: string, parsed: StatusArguments): Readonly<Record<string, unknown>> {
  if (parsed.profile === undefined || parsed.manifest === undefined) {
    return Object.freeze({ status: "not-selected", reasonCode: "STATUS_PROFILE_NOT_SELECTED", selectionRequired: ["--profile", "--manifest"] });
  }
  let work;
  try { work = deriveWork(loadSemanticGraph(repositoryRoot, parsed.manifest), { selector: `profile:${parsed.profile}`, maxItems: parsed.maxItems }); }
  catch (error) {
    const stable = error instanceof UsfError
      ? error.code
      : error instanceof Error
        ? /^([A-Z][A-Z0-9_]{1,95})(?::|$)/.exec(error.message)?.[1] ?? "GRAPH_LOAD_FAILED"
        : "GRAPH_LOAD_FAILED";
    throw new UsfError("STATUS_SEMANTIC_UNAVAILABLE", exitCodes.CURRENTNESS_FAILURE, "The explicitly selected semantic status could not be derived.", { reasonCode: stable });
  }
  if (work.status !== "ok" || work.items === undefined || work.semanticDigest === undefined || work.truncation === undefined) {
    throw new UsfError("STATUS_SEMANTIC_UNAVAILABLE", exitCodes.CURRENTNESS_FAILURE, "The explicitly selected semantic status was refused.", { reasonCode: work.reasonCode ?? "WORK_DERIVATION_REFUSED" });
  }
  return Object.freeze({
    status: "observed",
    profile: parsed.profile,
    manifest: parsed.manifest,
    semanticDigest: work.semanticDigest,
    work: {
      returned: work.items.length,
      maxItems: work.truncation.maxItems,
      truncated: work.truncation.truncated,
      ...(parsed.detail === "full" ? { ids: work.items.map((item) => item.id) } : {}),
      ready: null,
      completion: "not-observed",
    },
  });
}

async function broadStatus(repositoryRoot: string, args: readonly string[]): Promise<Readonly<Record<string, unknown>>> {
  const parsed = parseStatusArguments(args);
  const [lifecycle, providers, metrics] = await Promise.all([
    observeLifecycleStatus(repositoryRoot, parsed.instance),
    providerObservation(repositoryRoot),
    metricsSourceObservation(repositoryRoot),
  ]);
  const semantic = semanticObservation(repositoryRoot, parsed);
  const unobserved = [
    ...(semantic.status === "not-selected" ? ["semantic", "work"] : []),
    "active-chains",
    "eligible-routes",
    "throughput",
    "latest-checks",
    "integration-queue",
    "terminal-proof",
  ];
  return Object.freeze({
    schema: "urn:usf:status-result:1",
    version: 1,
    status: "observed",
    detail: parsed.detail,
    repository: repositoryObservation(repositoryRoot),
    semantic,
    lifecycle,
    providers,
    metrics,
    checks: { status: "not-observed" },
    integrationQueue: { status: "not-observed" },
    terminalProof: { status: "not-evaluated" },
    coverage: { complete: unobserved.length === 0, unobserved },
    externalContact: false,
    authorityEffect: "none",
    nonclaims: statusNonclaims,
  });
}

export const broadStatusCommandHandler: CommandHandler = async ({ args, repositoryRoot }) => {
  // Compatibility for the initial lifecycle slice. The explicit noun is the
  // stable spelling; `status --instance NAME` remains a lifecycle-only alias.
  if (args[0] === "lifecycle" || (args.length === 2 && args[0] === "--instance")) {
    const lifecycleArgs = args[0] === "lifecycle" ? args.slice(1) : args;
    if (lifecycleArgs.length !== 0 && (lifecycleArgs.length !== 2 || lifecycleArgs[0] !== "--instance")) {
      throw new UsfError("STATUS_LIFECYCLE_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, "Lifecycle status accepts only --instance.");
    }
    const instance = validateInstanceSlug(lifecycleArgs[1] ?? "default");
    return { output: await observeLifecycleStatus(repositoryRoot, instance), exitCode: exitCodes.SUCCESS };
  }
  return { output: await broadStatus(repositoryRoot, args), exitCode: exitCodes.SUCCESS };
};
