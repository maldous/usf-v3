import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { canonicalDigest } from "../core/canonical.ts";
import { exitCodes, UsfError, type ExitCode } from "../core/errors.ts";
import { CredentialEnvError, loadCredentialEnvFile, parseProviderConfig, ProviderConfigError, providerCredentialNames } from "../providers/config.ts";
import type { ZeroPaidEconomicsInput } from "../providers/economics.ts";
import { localGitChildEnvironment } from "../providers/local-git.ts";
import { probeProvider, type ProbeFailureReason, type ProviderProbeResult } from "../providers/probe.ts";
import {
  createQualificationPolicy, createQualificationSuite, qualifySemanticProfile,
  QualificationError, type QualificationAgentProfile, type QualificationCase,
  type QualificationSuiteSnapshot, type SemanticQualificationInput,
  type SemanticQualificationResult,
  answerDigest, promptDigest, sealQualificationObservation,
  type QualificationObservation,
} from "../providers/qualification.ts";
import { loadSemanticGraph } from "../graph/index.ts";
import { readProviderBindings } from "../providers/provider-bindings.ts";
import { readProviderExecutionPolicy } from "../providers/provider-policy.ts";
import { readGraphDerivedEconomics } from "../providers/economics-projection.ts";
import { observeQualifiedTaskClasses } from "../providers/capabilities.ts";
import { deriveRouteUniverse } from "../providers/route-universe.ts";
import { observeAvailableRoutes } from "../providers/evidence-index.ts";
import { languageModelFor } from "./execute.ts";
import { mkdir, writeFile } from "node:fs/promises";
import type { CommandHandler } from "./dispatcher.ts";
import { observeInstalledAdapter, readLocalCatalogue } from "./models.ts";

const maximumInputBytes = 4 * 1024 * 1024;
const maximumTrackedBytes = 256 * 1024;
const maximumPathLength = 4_096;
const runFile = promisify(execFile);

function invalid(message: string): never {
  throw new UsfError("PROBE_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, message);
}

function contained(root: string, path: string): boolean {
  const relation = relative(root, path);
  return relation !== "" && relation !== ".." && !relation.startsWith(`..${sep}`);
}

function sameFile(left: Awaited<ReturnType<typeof lstat>>, right: Awaited<ReturnType<Awaited<ReturnType<typeof open>>["stat"]>>): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

async function readBoundedFile(repositoryRoot: string, path: string, maximumBytes: number, privateFile: boolean): Promise<Buffer> {
  const before = await lstat(path).catch(() => undefined);
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  if (before === undefined || !before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > maximumBytes
    || (privateFile && (uid === undefined || before.uid !== uid || (before.mode & 0o7777) !== 0o600))) {
    throw new UsfError("PROBE_INPUT_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "Probe input must be one safe bounded regular file.");
  }
  const canonicalRoot = await realpath(repositoryRoot);
  const canonicalPath = await realpath(path).catch(() => undefined);
  if (canonicalPath === undefined || !contained(canonicalRoot, canonicalPath)) {
    throw new UsfError("PROBE_INPUT_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "Probe input resolves outside the repository.");
  }
  const handle = await open(canonicalPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (!sameFile(before, opened)) throw new UsfError("PROBE_INPUT_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "Probe input changed while opening.");
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (!sameFile(before, after) || bytes.length !== before.size) throw new UsfError("PROBE_INPUT_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "Probe input changed while reading.");
    return bytes;
  } finally { await handle.close(); }
}

function decodeJson(bytes: Buffer, reasonCode = "PROBE_INPUT_INVALID"): unknown {
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
  catch { throw new UsfError(reasonCode, exitCodes.INVALID_INPUT, "Probe input must be one UTF-8 JSON object."); }
}

/** Read a bounded local evaluation envelope.  Stdin permits Unix composition; files stay in ignored local state. */
async function readJsonInput(repositoryRoot: string, source: string): Promise<unknown> {
  let bytes: Buffer;
  if (source === "-") {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of process.stdin) {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      total += value.length;
      if (total > maximumInputBytes) throw new UsfError("PROBE_INPUT_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "Probe stdin exceeds the bounded input size.");
      chunks.push(value);
    }
    bytes = Buffer.concat(chunks, total);
  } else {
    if (!/^\.usf\/inputs\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$/u.test(source)) {
      throw new UsfError("PROBE_INPUT_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "Probe file input must be an explicit repository-local .usf/inputs/*.json file.");
    }
    const path = resolve(repositoryRoot, source);
    if (!contained(repositoryRoot, path)) throw new UsfError("PROBE_INPUT_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "Probe input escapes the repository.");
    bytes = await readBoundedFile(repositoryRoot, path, maximumInputBytes, true);
  }
  return decodeJson(bytes);
}

function parseSemantic(args: readonly string[]): string {
  if (args.length !== 2 || args[0] !== "--input" || args[1] === "") invalid("usf probe semantic requires --input PATH|-.");
  return args[1]!;
}

interface AvailabilityArguments {
  readonly routeId: string;
  readonly envFile: string;
  readonly economicsFile: string;
  readonly timeoutMs: number;
}

function parseAvailability(args: readonly string[]): AvailabilityArguments {
  const values = new Map<string, string>();
  let allowInference = false;
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index]!;
    if (option === "--allow-inference") {
      if (allowInference) invalid("--allow-inference may appear only once.");
      allowInference = true;
      continue;
    }
    if (!["--route", "--env-file", "--economics", "--timeout-ms", "--max-cost-usd"].includes(option) || values.has(option)) invalid("Availability options must be unique and explicit.");
    const value = args[++index];
    if (value === undefined || value.length === 0 || value.startsWith("--")) invalid(`Missing value for ${option}.`);
    values.set(option, value);
  }
  const routeId = values.get("--route");
  const envFile = values.get("--env-file");
  const economicsFile = values.get("--economics");
  const maxCost = values.get("--max-cost-usd");
  if (!allowInference || routeId === undefined || envFile === undefined || economicsFile === undefined || maxCost === undefined) {
    invalid("Availability requires --route, --env-file, --economics, --allow-inference and --max-cost-usd 0.");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:+/-]{0,191}$/u.test(routeId)) invalid("--route is invalid.");
  if (envFile.length > maximumPathLength || envFile.includes("\u0000")) invalid("--env-file is invalid.");
  if (!/^0(?:\.0+)?$/u.test(maxCost)) invalid("--max-cost-usd must be exactly zero.");
  const timeoutText = values.get("--timeout-ms") ?? "10000";
  if (!/^[1-9][0-9]{0,4}$/u.test(timeoutText)) invalid("--timeout-ms must be a positive integer no greater than 30000.");
  const timeoutMs = Number(timeoutText);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs > 30_000) invalid("--timeout-ms must be a positive integer no greater than 30000.");
  return Object.freeze({ routeId, envFile, economicsFile, timeoutMs });
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid("Availability evidence must be one object.");
  return value as Record<string, unknown>;
}

async function assertTracked(repositoryRoot: string, path: string): Promise<void> {
  try {
    await runFile("git", ["-C", repositoryRoot, "ls-files", "--error-unmatch", "--", path], { timeout: 5_000, maxBuffer: 16 * 1024, env: localGitChildEnvironment(repositoryRoot) });
  } catch {
    throw new UsfError("PROBE_TRACKED_INPUT_REQUIRED", exitCodes.CURRENTNESS_FAILURE, "Provider configuration and policy must be tracked local files.");
  }
}

async function assertCredentialFileUntracked(repositoryRoot: string, selectedPath: string): Promise<void> {
  let root: string;
  try {
    const result = await runFile("git", ["-C", dirname(selectedPath), "rev-parse", "--show-toplevel"], { encoding: "utf8", timeout: 5_000, maxBuffer: 16 * 1024, env: localGitChildEnvironment(repositoryRoot) });
    root = result.stdout.trim();
  } catch { return; }
  const relation = relative(root, selectedPath);
  if (relation === "" || relation === ".." || relation.startsWith(`..${sep}`)) return;
  try {
    await runFile("git", ["-C", root, "ls-files", "--error-unmatch", "--", relation], { timeout: 5_000, maxBuffer: 16 * 1024, env: localGitChildEnvironment(repositoryRoot) });
  } catch { return; }
  throw new UsfError("PROBE_ENV_FILE_TRACKED", exitCodes.CONTAINMENT_REFUSAL, "Tracked credential files are refused.");
}

export async function readTrackedJson(repositoryRoot: string, path: string): Promise<unknown> {
  await assertTracked(repositoryRoot, path);
  return decodeJson(await readBoundedFile(repositoryRoot, resolve(repositoryRoot, path), maximumTrackedBytes, false));
}

function parsePolicy(value: unknown) {
  const policy = record(value);
  const expected = ["$schema", "maximumPaidCost", "paidFallback", "unknownPrice", "acceptedCostClasses"].sort();
  if (Object.keys(policy).sort().some((key, index) => key !== expected[index]) || Object.keys(policy).length !== expected.length
    || policy.$schema !== "urn:usf:policy:1" || policy.maximumPaidCost !== 0 || policy.paidFallback !== "prohibited" || policy.unknownPrice !== "ineligible"
    || !Array.isArray(policy.acceptedCostClasses) || new Set(policy.acceptedCostClasses).size !== policy.acceptedCostClasses.length
    || policy.acceptedCostClasses.some((item) => !["local", "zero-price", "free-quota"].includes(String(item)))) {
    throw new UsfError("PROBE_POLICY_INVALID", exitCodes.CURRENTNESS_FAILURE, "The tracked zero-paid policy is invalid.");
  }
  return Object.freeze({
    digest: canonicalDigest(policy, { rejectAbsolutePaths: true }),
    maximumPaidCost: 0 as const,
    paidFallback: "prohibited" as const,
    unknownPrice: "ineligible" as const,
    acceptedCostClasses: Object.freeze([...policy.acceptedCostClasses] as ("local" | "zero-price" | "free-quota")[]),
  });
}

function economicsInput(value: unknown, observedAt: string): ZeroPaidEconomicsInput {
  const input = record(value);
  const keys = Object.keys(input).sort();
  const expected = ["accountReferenceDigest", "evidence", "providerId", "requestedModelId"].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])
    || typeof input.providerId !== "string" || typeof input.requestedModelId !== "string" || typeof input.accountReferenceDigest !== "string") {
    invalid("Availability economics input must contain only providerId, requestedModelId, accountReferenceDigest and evidence.");
  }
  return { providerId: input.providerId, requestedModelId: input.requestedModelId, accountReferenceDigest: input.accountReferenceDigest, evidence: input.evidence, observedAt, maximumPaidCostUsd: 0 };
}

const localProbeExitCodes = Object.freeze({
  PROBE_ROUTE_UNSUPPORTED: exitCodes.NO_ELIGIBLE_ROUTE,
  PROBE_CREDENTIAL_MISSING: exitCodes.CURRENTNESS_FAILURE,
  PROBE_INPUT_INVALID: exitCodes.CURRENTNESS_FAILURE,
  PROBE_COST_CLASS_INELIGIBLE: exitCodes.NO_ELIGIBLE_ROUTE,
  PAID_FALLBACK_PROHIBITED: exitCodes.NO_ELIGIBLE_ROUTE,
  ENTITLEMENT_UNVERIFIED: exitCodes.CURRENTNESS_FAILURE,
  ENTITLEMENT_EXPIRED: exitCodes.CURRENTNESS_FAILURE,
  ENTITLEMENT_QUOTA_UNKNOWN: exitCodes.CURRENTNESS_FAILURE,
  ENTITLEMENT_QUOTA_EXHAUSTED: exitCodes.NO_ELIGIBLE_ROUTE,
  PROBE_MARKER_MISMATCH: exitCodes.EXTERNAL_UNAVAILABLE,
  PROBE_ACTUAL_IDENTITY_MISMATCH: exitCodes.EXTERNAL_UNAVAILABLE,
  PROBE_TIMEOUT: exitCodes.EXTERNAL_UNAVAILABLE,
  PROBE_AUTHENTICATION_FAILED: exitCodes.EXTERNAL_UNAVAILABLE,
  PROBE_RATE_LIMITED: exitCodes.EXTERNAL_UNAVAILABLE,
  PROBE_PAYMENT_REQUIRED: exitCodes.EXTERNAL_UNAVAILABLE,
  PROBE_COST_NONZERO: exitCodes.EXTERNAL_UNAVAILABLE,
  PROBE_INVOCATION_FAILED: exitCodes.EXTERNAL_UNAVAILABLE,
} satisfies Readonly<Record<ProbeFailureReason, ExitCode>>);

export function availabilityExitCode(output: ProviderProbeResult): ExitCode {
  if (output.status === "ok") return exitCodes.SUCCESS;
  if (output.externalContact) return exitCodes.EXTERNAL_UNAVAILABLE;
  return output.reasonCode === undefined ? exitCodes.CURRENTNESS_FAILURE : localProbeExitCodes[output.reasonCode];
}

/** No trusted account-tier receipt acquisition contract exists in this graph slice. */
function trustedAccountTierReceiptAvailable(): boolean {
  return false;
}

async function runAvailability(repositoryRoot: string, args: readonly string[]) {
  const parsed = parseAvailability(args);
  const configValue = await readTrackedJson(repositoryRoot, "config/providers.json");
  const policy = parsePolicy(await readTrackedJson(repositoryRoot, "config/policy.json"));
  let config;
  try { config = parseProviderConfig(configValue); }
  catch (error) {
    throw new UsfError("PROBE_PROVIDER_CONFIG_INVALID", exitCodes.CURRENTNESS_FAILURE, "The tracked provider configuration is invalid.", error instanceof ProviderConfigError ? { configReasonCode: error.reasonCode } : undefined);
  }
  const route = config.routes.find((item) => item.id === parsed.routeId);
  if (route === undefined) throw new UsfError("PROBE_ROUTE_UNKNOWN", exitCodes.INVALID_INPUT, "The selected configured route does not exist.");
  const economics = economicsInput(await readJsonInput(repositoryRoot, parsed.economicsFile), new Date().toISOString());
  if (economics.providerId !== route.provider || economics.requestedModelId !== route.model) {
    throw new UsfError("PROBE_ECONOMICS_BINDING_MISMATCH", exitCodes.CURRENTNESS_FAILURE, "The zero-paid evidence is not bound to the selected provider and model.");
  }
  // Current provider documentation exposes no authenticated read-only API that
  // can independently bind exact account tier and paid-fallback state. A
  // self-authored file is integrity evidence only, so it cannot unlock contact.
  if (!trustedAccountTierReceiptAvailable()) {
    throw new UsfError("PROBE_ACCOUNT_TIER_UNVERIFIABLE", exitCodes.CURRENTNESS_FAILURE, "No registered trusted account-tier receipt is available; provider contact remains disabled.");
  }

  const catalogue = await readLocalCatalogue(repositoryRoot);
  const catalogueProvider = catalogue.snapshot.providers.find((item) => item.providerRoute === route.provider);
  const catalogueModel = catalogueProvider?.models.find((item) => item.route.model === route.model);
  if (catalogueProvider === undefined || catalogueModel === undefined || catalogueProvider.adapter.package !== route.adapterPackage
    || catalogueProvider.adapter.installedVersion === null || !catalogueProvider.credentialNames.includes(route.credentialName)) {
    throw new UsfError("PROBE_CATALOGUE_BINDING_UNAVAILABLE", exitCodes.CURRENTNESS_FAILURE, "The selected route is not exactly bound to the frozen catalogue and installed adapter observation.");
  }
  const envPath = resolve(repositoryRoot, parsed.envFile);
  await assertCredentialFileUntracked(repositoryRoot, envPath);
  let environment;
  try { environment = await loadCredentialEnvFile(envPath, providerCredentialNames(config)); }
  catch (error) {
    throw new UsfError("PROBE_ENV_FILE_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The explicit credential file was refused.", error instanceof CredentialEnvError ? { credentialReasonCode: error.reasonCode } : undefined);
  }
  // This is deliberately the final filesystem observation before the bounded
  // probe core can cross the provider contact boundary.
  const adapterObservation = await observeInstalledAdapter(repositoryRoot, route.adapterPackage);
  if (adapterObservation === undefined || adapterObservation.version !== catalogueProvider.adapter.installedVersion) {
    throw new UsfError("PROBE_ADAPTER_OBSERVATION_STALE", exitCodes.CURRENTNESS_FAILURE, "The current exact adapter install no longer matches the frozen catalogue observation.");
  }
  const output = await probeProvider({
    route,
    adapterObservation,
    credential: environment.getCredential(route.credentialName),
    catalogue: { rawDigest: catalogue.snapshot.rawDigest, normalizedDigest: catalogue.snapshot.normalizedDigest },
    policy,
    observedAt: economics.observedAt,
    timeoutMs: parsed.timeoutMs,
    entitlement: economics,
  });
  return { output, exitCode: availabilityExitCode(output) } as const;
}

/**
 * Deterministically grades stored answers against a versioned suite. It never
 * contacts a provider unless the explicit availability path passes every
 * local catalogue, credential, policy and zero-paid economics preflight.
 */

/**
 * Run one task class of the qualification suite against one exact route, from
 * real invocations, and store what it earned.
 *
 * This is the step that had no implementation. The evaluator existed and the
 * suite existed, but nothing carried a suite case to a model and brought the
 * answer back as evidence, so the only way to reach `probe semantic` was to
 * hand it an answers array -- which is precisely why answers were
 * unauthenticated. The runner closes the loop: one invocation per case, each
 * sealed into an observation carrying the digest of its own execution evidence,
 * and the set graded as a whole.
 *
 * It writes an execution evidence record per invocation and one qualification
 * record for the set. Both are ignored local state: evidence, not authority.
 */

interface ResolvedQualificationRoute {
  readonly provider: string;
  readonly model: string;
  readonly transport: string;
  readonly adapterPackage: string;
  readonly baseUrl: string | null;
  readonly credential: string;
  readonly effectivePolicyDigest: string;
  readonly profile: QualificationAgentProfile;
}

/**
 * Find the exact route in the classified universe and build the agent profile
 * the qualification will be bound to.
 *
 * The universe is derived the same way execution derives it, so a route that
 * execution would refuse -- unauthorised economics, absent credential, missing
 * adapter -- cannot be qualified either. This is the one place qualification
 * touches economics, and it touches it in the safe direction: economics may
 * prevent a qualification run from happening, and a qualification can never
 * create economic permission.
 */
async function resolveQualificationRoute(
  repositoryRoot: string,
  request: { readonly provider: string; readonly model: string; readonly envFile: string; readonly observedAt: string },
): Promise<ResolvedQualificationRoute> {
  const catalogue = await readLocalCatalogue(repositoryRoot);
  const semanticGraph = loadSemanticGraph(repositoryRoot, "graph/manifests/v3-convention.json");
  const bindings = readProviderBindings(semanticGraph);
  const executionPolicy = readProviderExecutionPolicy(semanticGraph);
  const economics = readGraphDerivedEconomics(
    await readTrackedJson(repositoryRoot, "config/execution-economics.json"), semanticGraph);

  const declaredAdapters = [...new Set(catalogue.snapshot.providers
    .map((provider) => provider.adapter.package).filter((value): value is string => typeof value === "string"))];
  const installed: string[] = [];
  for (const adapterPackage of declaredAdapters) {
    if (await observeInstalledAdapter(repositoryRoot, adapterPackage) !== undefined) installed.push(adapterPackage);
  }

  const allowlist = Object.freeze([...new Set(catalogue.snapshot.providers
    .flatMap((provider) => provider.credentialNames ?? []))]
    .filter((name) => /^[A-Z_][A-Z0-9_]{0,127}$/u.test(name)).sort());
  const envPath = resolve(repositoryRoot, request.envFile);
  let environment;
  try { environment = await loadCredentialEnvFile(envPath, allowlist); }
  catch (error) {
    throw new UsfError("PROBE_QUALIFY_ENV_FILE_REFUSED", exitCodes.CONTAINMENT_REFUSAL,
      "The explicit credential file was refused.",
      error instanceof CredentialEnvError ? { credentialReasonCode: error.reasonCode } : undefined);
  }
  const suppliedCredentialNames = Object.freeze(allowlist.filter((name) => {
    const value = environment.getCredential(name);
    return typeof value === "string" && value.length > 0;
  }).sort());

  const universe = deriveRouteUniverse({
    localAgentCapabilities: [],
    // The same earned-task-class observation routing uses. This call site
    // omitted it while the field was optional, so the availability preflight
    // reported a universe that ignored qualification entirely; the field is
    // required now and the omission is no longer expressible.
    qualifiedTaskClassesByRoute: (await observeQualifiedTaskClasses(repositoryRoot, new Date())).byRoute,
    transportSelectedModel: bindings.transportSelectedModel,
    snapshot: catalogue.snapshot,
    installedAdapterPackages: Object.freeze(installed),
    suppliedCredentialNames,
    authorizations: economics.authorizations,
    policy: economics.policy,
    requirement: { requiredCapabilities: [], minimumContextTokens: null, minimumOutputTokens: null },
    observedAvailableRouteIds: (await observeAvailableRoutes(repositoryRoot)).routeIds,
    executionPolicy,
    credentialAliases: bindings.credentialAliases,
    providerEndpoints: bindings.endpoints,
  });

  const candidate = universe.candidates.find((entry) =>
    entry.provider === request.provider && entry.model === request.model);
  if (candidate === undefined) {
    throw new UsfError("PROBE_QUALIFY_ROUTE_NOT_SELECTABLE", exitCodes.NO_ELIGIBLE_ROUTE,
      "That provider and model is not a selectable candidate; qualification cannot reach a route execution would refuse.",
      { provider: request.provider, model: request.model });
  }
  if (candidate.adapterPackage === null || candidate.credentialName === null) {
    throw new UsfError("PROBE_QUALIFY_ROUTE_UNSUPPORTED", exitCodes.NO_ELIGIBLE_ROUTE,
      "Only an adapter-carried route can be qualified through this path.", { provider: request.provider });
  }
  const credential = environment.getCredential(candidate.credentialName);
  if (typeof credential !== "string" || credential.length === 0) {
    throw new UsfError("PROBE_QUALIFY_CREDENTIAL_MISSING", exitCodes.CURRENTNESS_FAILURE,
      "The selected route's credential is absent from the supplied file.");
  }
  const adapterObservation = await observeInstalledAdapter(repositoryRoot, candidate.adapterPackage);
  if (adapterObservation === undefined) {
    throw new UsfError("PROBE_QUALIFY_ADAPTER_MISSING", exitCodes.EXTERNAL_UNAVAILABLE,
      "The selected route's adapter is not installed.", { adapterPackage: candidate.adapterPackage });
  }

  // The profile records how the model was driven. Qualification is scoped to
  // these declarations, so a run under a different prompt or output
  // configuration is a different qualification rather than a refreshed one.
  const profile: QualificationAgentProfile = Object.freeze({
    schema: "urn:usf:agent-profile:1" as const,
    provider: candidate.provider,
    requestedModel: candidate.model!,
    adapter: candidate.adapterPackage,
    adapterVersion: adapterObservation.version,
    adapterLockDigest: adapterObservation.lockDigest,
    authMode: "api_token" as const,
    toolProfile: "qualification-no-tools",
    toolProfileDigest: canonicalDigest({ toolProfile: "qualification-no-tools" }, { rejectAbsolutePaths: true }),
    promptVersion: "suite-declared-prompts",
    promptDigest: canonicalDigest({ promptVersion: "suite-declared-prompts" }, { rejectAbsolutePaths: true }),
    contextConfig: "suite-case-prompt-only",
    contextConfigDigest: canonicalDigest({ contextConfig: "suite-case-prompt-only" }, { rejectAbsolutePaths: true }),
    outputConfig: "bounded-text",
    outputConfigDigest: canonicalDigest({ outputConfig: "bounded-text" }, { rejectAbsolutePaths: true }),
  });

  return Object.freeze({
    provider: candidate.provider,
    model: candidate.model!,
    transport: candidate.transport,
    adapterPackage: candidate.adapterPackage,
    baseUrl: candidate.baseUrl,
    credential,
    effectivePolicyDigest: economics.closureDigest,
    profile,
  });
}

/**
 * Invoke the model once per suite case and seal each answer into an
 * observation. A case whose invocation fails is simply not observed, so it
 * scores zero rather than blocking the rest: a route that answers four of five
 * questions has earned whatever four answers are worth.
 */
async function runQualificationSuite(
  repositoryRoot: string,
  route: ResolvedQualificationRoute,
  cases: readonly QualificationCase[],
  maxOutputTokens: number,
  suite: QualificationSuiteSnapshot,
): Promise<{ readonly observations: readonly QualificationObservation[]; readonly failures: readonly string[] }> {
  const { generateText } = await import("ai");
  const model = await languageModelFor(route.adapterPackage, route.model, route.credential, route.baseUrl);
  const observations: QualificationObservation[] = [];
  const failures: string[] = [];
  for (const item of cases) {
    const startedAt = new Date();
    let text: string;
    try {
      const response = await generateText({
        model: model as Parameters<typeof generateText>[0]["model"],
        prompt: item.prompt,
        maxOutputTokens,
      });
      text = String(response.text ?? "");
      // An invocation that returns no text has not answered. Recording it as an
      // empty answer would grade it as wrong, which is a different claim and a
      // misleading one: measured on cohere/north-mini-code-1-0, a 256-token
      // output budget was consumed entirely by reasoning tokens and three of
      // four cases came back empty, scoring zero as though the model had
      // answered badly. The same run at 4096 tokens answered all four. So an
      // empty result is a failed invocation, not a failed answer, and the case
      // is left unobserved -- still zero, but visibly unanswered.
      if (text.trim().length === 0) {
        failures.push(`${item.caseId}: NO_TEXT_RETURNED (output budget ${maxOutputTokens}, ${
          Number(response.usage?.outputTokens ?? 0)} output tokens consumed)`);
        continue;
      }
      const usage = {
        inputTokens: Number(response.usage?.inputTokens ?? 0),
        outputTokens: Number(response.usage?.outputTokens ?? 0),
        totalTokens: Number(response.usage?.totalTokens ?? 0),
      };
      const completedAt = new Date();
      // One execution evidence record per invocation, so the observation's
      // executionEvidenceDigest points at something that exists.
      const evidence = Object.freeze({
        schema: "urn:usf:qualification-invocation-evidence:1" as const,
        provider: route.provider, requestedModel: route.model, actualModel: route.model,
        transport: route.transport, adapterPackage: route.adapterPackage,
        adapterVersion: route.profile.adapterVersion, adapterLockDigest: route.profile.adapterLockDigest,
        suiteId: suite.corpus.corpusId, suiteVersion: suite.suiteVersion,
        caseId: item.caseId, prompt: item.prompt, answer: text,
        startedAt: startedAt.toISOString(), completedAt: completedAt.toISOString(),
        latencyMs: completedAt.getTime() - startedAt.getTime(), usage,
      });
      const evidenceDigest = canonicalDigest(evidence, { rejectAbsolutePaths: true });
      const directory = resolve(repositoryRoot, ".usf", "qualification-invocations");
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(resolve(directory, `${evidenceDigest.slice(7)}.json`),
        `${JSON.stringify({ ...evidence, evidenceDigest }, null, 2)}\n`, { mode: 0o600 });

      observations.push(sealQualificationObservation({
        schema: "urn:usf:qualification-observation:1",
        provider: route.provider,
        requestedModel: route.model,
        actualModel: route.model,
        transport: route.transport,
        adapterPackage: route.adapterPackage,
        adapterVersion: route.profile.adapterVersion,
        adapterLockDigest: route.profile.adapterLockDigest,
        caseId: item.caseId,
        promptDigest: promptDigest(item.prompt),
        answer: text,
        answerDigest: answerDigest(text),
        executionEvidenceDigest: evidenceDigest,
        observedAt: completedAt.toISOString(),
        latencyMs: completedAt.getTime() - startedAt.getTime(),
        usage,
      }));
    } catch (error) {
      // A refusal, timeout or transport error leaves the case unobserved. The
      // reason is recorded for the operator but never becomes an answer.
      failures.push(`${item.caseId}: ${error instanceof Error ? error.name : "invocation-failed"}`);
    }
  }
  return Object.freeze({ observations: Object.freeze(observations), failures: Object.freeze(failures) });
}

/**
 * Store what the run earned, in the shape the shared capability model reads.
 *
 * An unqualified outcome is stored too, with its UNQUALIFIED role. The reader
 * grants nothing for it, so recording it costs no authority and leaves the
 * operator able to see that the route was assessed rather than skipped.
 */
async function storeQualificationRecord(
  repositoryRoot: string,
  result: SemanticQualificationResult,
): Promise<{ readonly recordPath: string }> {
  const record = Object.freeze({
    schema: "urn:usf:qualification-record:1" as const,
    status: "ok" as const,
    role: result.derivedRoles[0] ?? "UNQUALIFIED",
    taskClass: result.taskClass,
    route: Object.freeze({ provider: result.profile.actual.provider, model: result.profile.requested.model }),
    expiresAt: result.validUntil,
    qualificationDigest: result.qualificationDigest,
    observationSetDigest: result.inputs.observationSetDigest,
    qualification: result,
  });
  const directory = resolve(repositoryRoot, ".usf", "qualifications");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const name = `${result.qualificationDigest.slice(7)}.json`;
  await writeFile(resolve(directory, name), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  return Object.freeze({ recordPath: `.usf/qualifications/${name}` });
}

interface QualifyArguments {
  readonly provider: string;
  readonly model: string;
  readonly taskClass: string;
  readonly envFile: string;
  readonly maxOutputTokens: number;
}

function parseQualify(args: readonly string[]): QualifyArguments {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index]!;
    const value = args[index + 1];
    if (!["--provider", "--model", "--task-class", "--env-file", "--max-output-tokens"].includes(option)
      || values.has(option) || value === undefined || value.length === 0 || value.startsWith("--")) {
      invalid("Qualify options must be unique and explicit.");
    }
    values.set(option, value);
  }
  const provider = values.get("--provider");
  const model = values.get("--model");
  const taskClass = values.get("--task-class");
  const envFile = values.get("--env-file");
  if (provider === undefined || model === undefined || taskClass === undefined || envFile === undefined) {
    invalid("Qualify requires --provider, --model, --task-class and --env-file.");
  }
  const tokensText = values.get("--max-output-tokens") ?? "512";
  if (!/^[1-9][0-9]{0,4}$/u.test(tokensText)) invalid("--max-output-tokens must be a positive integer.");
  const maxOutputTokens = Number(tokensText);
  if (maxOutputTokens > 8192) invalid("--max-output-tokens exceeds the bounded maximum.");
  return Object.freeze({ provider, model, taskClass, envFile, maxOutputTokens });
}

async function runQualify(repositoryRoot: string, args: readonly string[]) {
  const parsed = parseQualify(args);
  const observedAt = new Date().toISOString();

  const qualificationConfig = await readTrackedJson(repositoryRoot, "config/qualification.json");
  const configRecord = qualificationConfig as {
    readonly suite: Parameters<typeof createQualificationSuite>[0];
    readonly policy: Parameters<typeof createQualificationPolicy>[0];
  };
  const suite = createQualificationSuite(configRecord.suite);
  const policy = createQualificationPolicy(configRecord.policy);
  const cases = suite.corpus.cases.filter((item) => item.taskClass === parsed.taskClass);
  if (cases.length === 0) {
    throw new UsfError("PROBE_QUALIFY_TASK_CLASS_UNKNOWN", exitCodes.INVALID_INPUT,
      "The qualification suite declares no case for that task class.", { taskClass: parsed.taskClass });
  }

  // The route is resolved from the same classified universe execution uses, so
  // qualification can never reach a route execution would refuse.
  const resolved = await resolveQualificationRoute(repositoryRoot, {
    provider: parsed.provider, model: parsed.model, envFile: parsed.envFile, observedAt,
  });
  const run = await runQualificationSuite(repositoryRoot, resolved, cases, parsed.maxOutputTokens, suite);

  // With no observation there is nothing to grade, and the evaluator refuses
  // rather than reporting a route as unqualified it never assessed. That
  // refusal is correct but opaque on its own, so the reasons the invocations
  // failed are reported here instead of being lost behind it.
  if (run.observations.length === 0) {
    throw new UsfError("PROBE_QUALIFY_NO_OBSERVATION", exitCodes.EXTERNAL_UNAVAILABLE,
      "Every suite invocation failed, so there is no evidence to grade and the route is neither qualified nor unqualified.",
      { taskClass: parsed.taskClass, failures: run.failures });
  }

  const result = qualifySemanticProfile({
    profile: resolved.profile,
    taskClass: parsed.taskClass,
    suite,
    policy,
    effectivePolicyDigest: resolved.effectivePolicyDigest,
    observations: run.observations,
    evaluatedAt: new Date().toISOString(),
  });

  const stored = await storeQualificationRecord(repositoryRoot, result);
  return {
    output: Object.freeze({
      schema: "urn:usf:qualification-run-result:1" as const,
      status: result.status,
      taskClass: result.taskClass,
      route: Object.freeze({ provider: resolved.provider, model: resolved.model, transport: resolved.transport }),
      invocations: run.observations.length,
      casesTotal: result.casesTotal,
      casesAnswered: result.casesAnswered,
      casesPassed: result.casesPassed,
      taskScore: result.taskScore,
      derivedRoles: result.derivedRoles,
      observationSetDigest: result.inputs.observationSetDigest,
      qualificationDigest: result.qualificationDigest,
      validUntil: result.validUntil,
      recordPath: stored.recordPath,
      failures: run.failures,
      externalContact: true as const,
      authorityEffect: "none" as const,
      nonClaims: Object.freeze([
        "A qualification is earned from the observations recorded here and expires with the declared policy window.",
        "It grants no economic authorization: whether this route may be executed remains decided where execution is authorised.",
        "It asserts nothing about account tier, quota, billing or provider-console state.",
      ]),
    }),
    exitCode: result.status === "qualified" ? exitCodes.SUCCESS : exitCodes.NO_ELIGIBLE_ROUTE,
  } as const;
}

export const probeCommandHandler: CommandHandler = async ({ args, repositoryRoot }) => {
  const [operation, ...remaining] = args;
  if (operation === "availability") return runAvailability(repositoryRoot, remaining);
  if (operation === "qualify") return runQualify(repositoryRoot, remaining);
  if (operation !== "semantic") invalid("Probe requires exactly one of availability, qualify or semantic.");
  const input = await readJsonInput(repositoryRoot, parseSemantic(remaining));
  try {
    const output = qualifySemanticProfile(input as SemanticQualificationInput);
    return { output, exitCode: output.status === "qualified" ? exitCodes.SUCCESS : exitCodes.NO_ELIGIBLE_ROUTE };
  } catch (error) {
    const reasonCode = error instanceof QualificationError ? error.reasonCode : "QUALIFICATION_INPUT_INVALID";
    throw new UsfError("PROBE_SEMANTIC_INPUT_INVALID", exitCodes.INVALID_INPUT, "Semantic probe input does not satisfy the closed qualification contract.", { reasonCode });
  }
};
