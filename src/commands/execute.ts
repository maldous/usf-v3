import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { canonicalDigest } from "../core/canonical.ts";
import { exitCodes, UsfError, type ExitCode } from "../core/errors.ts";
import { type RoutingRequirement } from "../providers/classification.ts";
import { deriveRouteUniverse, type ExecutionCandidate } from "../providers/route-universe.ts";
import { observeTransportCapability } from "../providers/transports.ts";
import { CredentialEnvError, loadCredentialEnvFile } from "../providers/config.ts";
import {
  parseExecutionEconomicAuthorizations, type EffectiveCostPolicy,
} from "../providers/execution-economics.ts";
import type { CommandHandler } from "./dispatcher.ts";
import { observeInstalledAdapter, readLocalCatalogue } from "./models.ts";
import { observeAvailableRoutes } from "../providers/evidence-index.ts";
import { readGraphDerivedEconomics } from "../providers/economics-projection.ts";
import { loadSemanticGraph } from "../graph/index.ts";
import { readProviderBindings, type ProviderBindings } from "../providers/provider-bindings.ts";
import { readProviderExecutionPolicy, type ProviderExecutionPolicy } from "../providers/provider-policy.ts";
import { readTrackedJson } from "./probe.ts";

const maximumPromptBytes = 64 * 1024;
const defaultMaximumOutputTokens = 1024;
const hardMaximumOutputTokens = 8192;
const defaultTimeoutMs = 60_000;
const maximumAttempts = 4;

function invalid(message: string): never {
  throw new UsfError("EXECUTE_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, message);
}

export function parseEffectiveCostPolicy(value: unknown): EffectiveCostPolicy {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new UsfError("EXECUTE_POLICY_INVALID", exitCodes.CURRENTNESS_FAILURE, "The tracked cost policy is invalid.");
  }
  const record = value as Record<string, unknown>;
  const classes = record.acceptedCostClasses;
  if (typeof record.maximumPaidCost !== "number" || typeof record.paidFallback !== "string"
    || typeof record.unknownPrice !== "string" || !Array.isArray(classes) || classes.some((entry) => typeof entry !== "string")) {
    throw new UsfError("EXECUTE_POLICY_INVALID", exitCodes.CURRENTNESS_FAILURE, "The tracked cost policy is invalid.");
  }
  return Object.freeze({
    maximumPaidCost: record.maximumPaidCost,
    paidFallback: record.paidFallback,
    unknownPrice: record.unknownPrice,
    acceptedCostClasses: Object.freeze([...classes as string[]]),
  });
}

interface ParsedExecuteArguments {
  readonly prompt: string;
  readonly envFile: string;
  readonly maximumOutputTokens: number;
  readonly requirement: RoutingRequirement;
  readonly providerFilter: string | null;
  readonly modelFilter: string | null;
}

function parse(args: readonly string[]): ParsedExecuteArguments {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index]!;
    if (!["--prompt", "--env-file", "--max-output-tokens", "--require-capability", "--minimum-context", "--provider", "--model"].includes(option)) {
      invalid(`Unknown execute option: ${option}`);
    }
    const value = args[++index];
    if (value === undefined || value.length === 0 || value.startsWith("--")) invalid(`Missing value for ${option}.`);
    if (option === "--require-capability") {
      values.set(option, values.has(option) ? `${values.get(option)!},${value}` : value);
      continue;
    }
    if (values.has(option)) invalid(`Option ${option} may appear only once.`);
    values.set(option, value);
  }
  const prompt = values.get("--prompt");
  const envFile = values.get("--env-file");
  if (prompt === undefined || envFile === undefined) invalid("Execute requires --prompt and --env-file.");
  if (Buffer.byteLength(prompt, "utf8") > maximumPromptBytes) invalid("The work request prompt exceeds the bounded size.");
  const tokensText = values.get("--max-output-tokens") ?? String(defaultMaximumOutputTokens);
  if (!/^[1-9][0-9]{0,4}$/u.test(tokensText)) invalid("--max-output-tokens must be a positive integer.");
  const maximumOutputTokens = Number(tokensText);
  if (maximumOutputTokens > hardMaximumOutputTokens) invalid("--max-output-tokens exceeds the bounded maximum.");
  const contextText = values.get("--minimum-context");
  if (contextText !== undefined && !/^[1-9][0-9]{0,9}$/u.test(contextText)) invalid("--minimum-context must be a positive integer.");
  const capabilityText = values.get("--require-capability");
  return Object.freeze({
    prompt,
    envFile,
    maximumOutputTokens,
    requirement: Object.freeze({
      requiredCapabilities: Object.freeze(capabilityText === undefined ? [] : [...new Set(capabilityText.split(","))].sort()),
      minimumContextTokens: contextText === undefined ? null : Number(contextText),
      minimumOutputTokens: maximumOutputTokens,
    }),
    providerFilter: values.get("--provider") ?? null,
    modelFilter: values.get("--model") ?? null,
  });
}

/**
 * Build one AI SDK language model for a classified candidate. Every catalogue
 * adapter package is an AI SDK provider; the mapping stays data-driven so a
 * newly installed adapter becomes usable without changing routing logic.
 */
export async function languageModelFor(
  adapterPackage: string,
  modelId: string,
  credential: string,
  baseUrl: string | null = null,
): Promise<unknown> {
  // One factory per installed adapter package. A provider becomes reachable by
  // installing its adapter and declaring any endpoint it needs; no routing logic
  // changes.
  switch (adapterPackage) {
    case "@ai-sdk/groq":
      return (await import("@ai-sdk/groq")).createGroq({ apiKey: credential })(modelId);
    case "@ai-sdk/cerebras":
      return (await import("@ai-sdk/cerebras")).createCerebras({ apiKey: credential })(modelId);
    case "@openrouter/ai-sdk-provider":
      return (await import("@openrouter/ai-sdk-provider")).createOpenRouter({ apiKey: credential })(modelId);
    case "@ai-sdk/openai":
      return (await import("@ai-sdk/openai")).createOpenAI({ apiKey: credential })(modelId);
    case "@ai-sdk/mistral":
      return (await import("@ai-sdk/mistral")).createMistral({ apiKey: credential })(modelId);
    case "@ai-sdk/togetherai":
      return (await import("@ai-sdk/togetherai")).createTogetherAI({ apiKey: credential })(modelId);
    case "@ai-sdk/cohere":
      return (await import("@ai-sdk/cohere")).createCohere({ apiKey: credential })(modelId);
    case "@ai-sdk/openai-compatible": {
      // The catalogue carries no endpoint; it comes from graph authority.
      if (baseUrl === null) {
        throw new UsfError("EXECUTE_PROVIDER_ENDPOINT_UNDECLARED", exitCodes.NO_ELIGIBLE_ROUTE,
          "An OpenAI-compatible provider requires a graph-declared endpoint.", { adapterPackage, modelId });
      }
      return (await import("@ai-sdk/openai-compatible"))
        .createOpenAICompatible({ name: "usf-openai-compatible", apiKey: credential, baseURL: baseUrl })(modelId);
    }
    default:
      throw new UsfError("EXECUTE_ADAPTER_UNSUPPORTED", exitCodes.NO_ELIGIBLE_ROUTE,
        "The selected candidate's adapter package has no registered AI SDK factory.", { adapterPackage });
  }
}

export const executeCommandHandler: CommandHandler = async ({ args, repositoryRoot }) => {
  const parsed = parse(args);
  const observedAt = new Date().toISOString();

  const requirement = Object.freeze({
    schema: "urn:usf:work-requirement:1" as const,
    prompt: parsed.prompt,
    requiredCapabilities: parsed.requirement.requiredCapabilities,
    minimumContextTokens: parsed.requirement.minimumContextTokens,
    maximumOutputTokens: parsed.maximumOutputTokens,
  });
  const requestDigest = canonicalDigest(requirement);

  // Economics come from graph authority through the verified projection; no
  // surface decides against a separately maintained policy file.
  const semanticGraph = loadSemanticGraph(repositoryRoot, "graph/manifests/v3-convention.json");
  const bindings = readProviderBindings(semanticGraph);
  const executionPolicy = readProviderExecutionPolicy(semanticGraph);
  const economics = readGraphDerivedEconomics(
    await readTrackedJson(repositoryRoot, "config/execution-economics.json"),
    semanticGraph,
  );
  const policy = economics.policy;
  const authorizations = economics.authorizations;
  const catalogue = await readLocalCatalogue(repositoryRoot);

  const adapterPackages = Object.freeze([...new Set(
    catalogue.snapshot.providers.map((provider) => provider.adapter.package)
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  )].sort());
  const installed: string[] = [];
  for (const adapterPackage of adapterPackages) {
    if (await observeInstalledAdapter(repositoryRoot, adapterPackage) !== undefined) installed.push(adapterPackage);
  }

  const environmentNamePattern = /^[A-Z_][A-Z0-9_]{0,127}$/u;
  // The catalogue projection is the authority for credential names.
  const allowlist = Object.freeze([...new Set(
    catalogue.snapshot.providers.flatMap((provider) => provider.credentialNames ?? []),
  )].filter((name) => environmentNamePattern.test(name)).sort());
  const envPath = resolve(repositoryRoot, parsed.envFile);
  let environment;
  try {
    environment = await loadCredentialEnvFile(envPath, allowlist);
  } catch (error) {
    throw new UsfError("EXECUTE_ENV_FILE_REFUSED", exitCodes.CONTAINMENT_REFUSAL,
      "The explicit credential file was refused.",
      error instanceof CredentialEnvError ? { credentialReasonCode: error.reasonCode } : undefined);
  }
  const suppliedCredentialNames = Object.freeze(allowlist.filter((name) => {
    const value = environment.getCredential(name);
    return typeof value === "string" && value.length > 0;
  }).sort());

  // One candidate universe, identical to the one graph execution routes over:
  // the whole classified catalogue plus every admitted local agent transport.
  const localAgentCapabilities = Object.freeze(await Promise.all(
    (["antigravity-cli", "claude-cli", "codex-cli"] as const).map((transport) => observeTransportCapability(transport, {
      repositoryRoot, homeDirectory: homedir(), observedAt,
      suppliedCredentialNames, requiredCredentialName: null, adapterInstalled: false,
    })),
  ));
  const universe = deriveRouteUniverse({
    localAgentCapabilities,
    transportSelectedModel: bindings.transportSelectedModel,
    snapshot: catalogue.snapshot,
    installedAdapterPackages: Object.freeze(installed),
    suppliedCredentialNames,
    authorizations,
    policy,
    requirement: parsed.requirement,
    observedAvailableRouteIds: (await observeAvailableRoutes(repositoryRoot)).routeIds,
    executionPolicy,
    credentialAliases: bindings.credentialAliases,
    providerEndpoints: bindings.endpoints,
  });

  const summary = universe.catalogueSummary;
  const selectable = universe.candidates.filter((entry) =>
    (parsed.providerFilter === null || entry.provider === parsed.providerFilter || entry.transport === parsed.providerFilter)
    && (parsed.modelFilter === null || entry.model === parsed.modelFilter));

  // Prefer a route with a durable successful invocation, then stable identity.
  const ordered = Object.freeze([...selectable].sort((left, right) => {
    if (left.state !== right.state) return left.state === "AVAILABLE" ? -1 : 1;
    return left.candidateId.localeCompare(right.candidateId);
  }));
  const selectionRule = "AVAILABLE before ROUTABLE, then ascending provider and model identity";

  const discovery = Object.freeze({
    catalogueRawDigest: catalogue.snapshot.rawDigest,
    catalogueNormalizedDigest: catalogue.snapshot.normalizedDigest,
    catalogueSource: catalogue.snapshot.source,
    classificationDigest: summary.classificationDigest,
    providerCount: summary.providerCount,
    modelCount: summary.modelCount,
    stateCounts: summary.stateCounts,
    reasonCounts: summary.reasonCounts,
    selectableCandidateCount: ordered.length,
    localAgentDispositions: universe.localAgentDispositions,
    consideredCandidates: Object.freeze(ordered.slice(0, maximumAttempts)),
  });

  interface InvocationAttempt {
    readonly provider: string;
    readonly model: string | null;
    readonly adapterPackage: string | null;
    readonly transport: string | null;
    readonly startedAt: string;
    readonly latencyMs: number;
    readonly outcome: "ok" | "refused";
    readonly statusCode: number | null;
    readonly reasonCode: string;
    readonly costIncurred: boolean;
  }

  if (ordered.length === 0) {
    return {
      output: Object.freeze({
        schema: "urn:usf:execution-evidence:1" as const,
        version: 1 as const,
        status: "no-eligible-route" as const,
        observedAt, requestDigest, request: requirement, discovery,
        attempts: Object.freeze([]), selection: null, invocation: null, result: null,
        nonClaims: Object.freeze(["No candidate reached a routable state; no external model was contacted."]),
      }),
      exitCode: exitCodes.NO_ELIGIBLE_ROUTE as ExitCode,
    };
  }

  const { generateText } = await import("ai");
  const attempts: InvocationAttempt[] = [];
  let selected: ExecutionCandidate | undefined;
  let generated: Awaited<ReturnType<typeof generateText>> | undefined;
  let cliResult: Awaited<ReturnType<typeof import("../providers/cli-transports.ts").invokeClaudeCli>> | undefined;
  let startedAt = "";
  let latencyMs = 0;
  let completedAt = "";

  for (const candidate of ordered.slice(0, maximumAttempts)) {
    const attemptStartedAt = new Date().toISOString();
    if (candidate.transport === "claude-cli" || candidate.transport === "codex-cli" || candidate.transport === "antigravity-cli") {
      const attemptStarted = performance.now();
      const { invokeAntigravityCli, invokeClaudeCli, invokeCodexCli } = await import("../providers/cli-transports.ts");
      const produced = candidate.transport === "claude-cli"
        ? await invokeClaudeCli(parsed.prompt, defaultTimeoutMs)
        : candidate.transport === "codex-cli"
          ? await invokeCodexCli(parsed.prompt, defaultTimeoutMs)
          : await invokeAntigravityCli(parsed.prompt, candidate.model ?? "", defaultTimeoutMs);
      const elapsed = Math.round(performance.now() - attemptStarted);
      attempts.push(Object.freeze({
        provider: candidate.provider, model: candidate.model, adapterPackage: candidate.adapterPackage,
        transport: candidate.transport, startedAt: attemptStartedAt, latencyMs: elapsed,
        outcome: produced.outcome, statusCode: null, reasonCode: produced.reasonCode, costIncurred: false,
      }));
      if (produced.outcome === "ok" && produced.text !== null) {
        selected = candidate; startedAt = attemptStartedAt; latencyMs = elapsed;
        completedAt = new Date().toISOString();
        cliResult = produced;
        break;
      }
      continue;
    }
    const credential = candidate.credentialName === null ? undefined : environment.getCredential(candidate.credentialName);
    if (credential === undefined || credential.length === 0 || candidate.adapterPackage === null) {
      attempts.push(Object.freeze({
        provider: candidate.provider, model: candidate.model, adapterPackage: candidate.adapterPackage,
        transport: candidate.transport, startedAt: attemptStartedAt, latencyMs: 0,
        outcome: "refused" as const, statusCode: null, reasonCode: "CREDENTIAL_ABSENT", costIncurred: false,
      }));
      continue;
    }
    const attemptStarted = performance.now();
    try {
      const model = await languageModelFor(candidate.adapterPackage, candidate.model ?? "", credential, candidate.baseUrl);
      const produced = await generateText({
        model: model as Parameters<typeof generateText>[0]["model"],
        prompt: parsed.prompt,
        maxOutputTokens: parsed.maximumOutputTokens,
        abortSignal: AbortSignal.timeout(defaultTimeoutMs),
      });
      const elapsed = Math.round(performance.now() - attemptStarted);
      attempts.push(Object.freeze({
        provider: candidate.provider, model: candidate.model, adapterPackage: candidate.adapterPackage,
        transport: candidate.transport, startedAt: attemptStartedAt, latencyMs: elapsed,
        outcome: "ok" as const, statusCode: 200, reasonCode: "INVOCATION_OK", costIncurred: false,
      }));
      selected = candidate; generated = produced; startedAt = attemptStartedAt;
      latencyMs = elapsed; completedAt = new Date().toISOString();
      break;
    } catch (error) {
      const elapsed = Math.round(performance.now() - attemptStarted);
      const status = typeof (error as { statusCode?: unknown }).statusCode === "number"
        ? (error as { statusCode: number }).statusCode : null;
      const reasonCode = status === 402 ? "PROVIDER_QUOTA_EXHAUSTED_PAYMENT_REQUIRED"
        : status === 429 ? "PROVIDER_RATE_LIMITED"
        : status === 401 || status === 403 ? "PROVIDER_AUTHENTICATION_REFUSED"
        : status === 404 ? "PROVIDER_MODEL_NOT_SERVED"
        : error instanceof Error && error.name === "TimeoutError" ? "PROVIDER_TIMEOUT"
        : "PROVIDER_INVOCATION_FAILED";
      attempts.push(Object.freeze({
        provider: candidate.provider, model: candidate.model, adapterPackage: candidate.adapterPackage,
        transport: candidate.transport, startedAt: attemptStartedAt, latencyMs: elapsed,
        outcome: "refused" as const, statusCode: status, reasonCode, costIncurred: false,
      }));
    }
  }

  if (selected === undefined || (generated === undefined && cliResult === undefined)) {
    return {
      output: Object.freeze({
        schema: "urn:usf:execution-evidence:1" as const,
        version: 1 as const,
        status: "no-transport-carried-the-request" as const,
        observedAt, requestDigest, request: requirement, discovery,
        attempts: Object.freeze(attempts), selection: null, invocation: null, result: null,
        nonClaims: Object.freeze([
          "Every attempted route refused before returning a result. No model output was produced.",
          "A payment-required or rate-limited refusal denied access without performing paid work; no cost was incurred.",
        ]),
      }),
      exitCode: exitCodes.EXTERNAL_UNAVAILABLE as ExitCode,
    };
  }

  const selection = Object.freeze({
    provider: selected.provider,
    model: selected.model,
    transport: selected.transport,
    adapterPackage: selected.adapterPackage,
    costClass: selected.costClass,
    classifiedState: selected.state,
    selectionRule,
    requestDigest,
  });
  const selectionDigest = canonicalDigest(selection);

  const quotaHeaderNames = ["x-ratelimit-limit-requests", "x-ratelimit-remaining-requests", "x-ratelimit-limit-tokens", "x-ratelimit-remaining-tokens", "x-ratelimit-reset-requests", "x-ratelimit-reset-tokens"];
  const rawHeaders = generated?.response?.headers ?? {};
  const quota = Object.freeze(Object.fromEntries(
    quotaHeaderNames.filter((name) => typeof rawHeaders[name] === "string").map((name) => [name, rawHeaders[name]]),
  ));

  const invocation = Object.freeze({
    selectionDigest,
    transport: selected.transport,
    requestedModel: selected.model,
    actualModel: cliResult !== undefined ? cliResult.actualModel : (generated?.response?.modelId ?? null),
    startedAt, completedAt, latencyMs,
    finishReason: cliResult !== undefined ? cliResult.reasonCode : generated?.finishReason ?? null,
    usage: Object.freeze({
      inputTokens: cliResult !== undefined ? cliResult.inputTokens : (generated?.usage?.inputTokens ?? null),
      outputTokens: cliResult !== undefined ? cliResult.outputTokens : (generated?.usage?.outputTokens ?? null),
      totalTokens: cliResult !== undefined ? cliResult.totalTokens : (generated?.usage?.totalTokens ?? null),
    }),
    providerReportedQuota: quota,
  });
  const invocationDigest = canonicalDigest(invocation);
  const resultText = cliResult !== undefined ? (cliResult.text ?? "") : (generated?.text ?? "");
  const resultDigest = canonicalDigest(resultText);

  const evidence = Object.freeze({
    schema: "urn:usf:execution-evidence:1" as const,
    version: 1 as const,
    status: "ok" as const,
    observedAt, requestDigest, request: requirement, discovery,
    attempts: Object.freeze(attempts),
    selection, selectionDigest,
    invocation, invocationDigest,
    result: Object.freeze({ text: resultText, textDigest: resultDigest }),
    chain: Object.freeze({
      request: requestDigest, selection: selectionDigest,
      invocation: invocationDigest, result: resultDigest,
    }),
    nonClaims: Object.freeze([
      "This record proves that the named model returned this text through the named transport under the recorded authority. It asserts no account tier, balance or subscription state.",
      "Provider-reported quota headers are copied verbatim as provider claims and are not independently verified.",
      "No credential value or digest of a credential appears in this record.",
    ]),
  });

  const evidenceDirectory = resolve(repositoryRoot, ".usf", "executions");
  await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
  const evidenceDigest = canonicalDigest(evidence);
  await writeFile(
    resolve(evidenceDirectory, `${evidenceDigest.slice("sha256:".length)}.json`),
    `${JSON.stringify(evidence, null, 1)}\n`,
    { mode: 0o600 },
  );

  return { output: Object.freeze({ ...evidence, evidenceDigest }), exitCode: exitCodes.SUCCESS as ExitCode };
};
