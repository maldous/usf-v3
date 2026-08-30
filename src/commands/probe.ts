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
import { qualifySemanticProfile, QualificationError, type SemanticQualificationInput } from "../providers/qualification.ts";
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

async function readTrackedJson(repositoryRoot: string, path: string): Promise<unknown> {
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
export const probeCommandHandler: CommandHandler = async ({ args, repositoryRoot }) => {
  const [operation, ...remaining] = args;
  if (operation === "availability") return runAvailability(repositoryRoot, remaining);
  if (operation !== "semantic") invalid("Probe requires exactly one of availability or semantic.");
  const input = await readJsonInput(repositoryRoot, parseSemantic(remaining));
  try {
    const output = qualifySemanticProfile(input as SemanticQualificationInput);
    return { output, exitCode: output.status === "qualified" ? exitCodes.SUCCESS : exitCodes.NO_ELIGIBLE_ROUTE };
  } catch (error) {
    const reasonCode = error instanceof QualificationError ? error.reasonCode : "QUALIFICATION_INPUT_INVALID";
    throw new UsfError("PROBE_SEMANTIC_INPUT_INVALID", exitCodes.INVALID_INPUT, "Semantic probe input does not satisfy the closed qualification contract.", { reasonCode });
  }
};
