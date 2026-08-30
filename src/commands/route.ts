import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { exitCodes, UsfError } from "../core/errors.ts";
import { localGitChildEnvironment } from "../providers/local-git.ts";
import {
  createQualificationPolicy,
  createQualificationSuite,
  type QualificationPolicyDefinition,
  type QualificationSuiteDefinition,
} from "../providers/qualification.ts";
import {
  routeWork,
  type RoutingInput,
  type RoutingStrategy,
  type TrustedSemanticQualificationAuthorityForRouting,
} from "../providers/routing.ts";
import type { CommandHandler } from "./dispatcher.ts";

const runFile = promisify(execFile);
const maximumInputBytes = 4 * 1024 * 1024;
const maximumAuthorityBytes = 512 * 1024;
const maximumAssignments = 10_000;
const qualificationAuthorityPath = "config/qualification.json";
const strategies = new Set<RoutingStrategy>(["all-eligible", "diverse", "fastest", "review-diverse", "deterministic-fixture"]);

interface ParsedRouteArguments {
  readonly input: string;
  readonly strategy: RoutingStrategy | undefined;
  readonly hostConcurrency: number | undefined;
  readonly maxAssignments: number | undefined;
}

function invalid(message: string): never {
  throw new UsfError("ROUTE_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, message);
}

function positive(value: string | undefined, option: string): number | undefined {
  if (value === undefined) return undefined;
  if (!/^[1-9][0-9]{0,8}$/u.test(value)) invalid(`${option} must be a bounded positive integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximumAssignments) invalid(`${option} is outside its supported bound.`);
  return parsed;
}

function parse(args: readonly string[]): ParsedRouteArguments {
  if (args.length === 0 || args.length % 2 !== 0) invalid("Route requires unique explicit flag/value pairs.");
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index]!;
    const value = args[index + 1]!;
    if (!option.startsWith("--") || value.length === 0 || values.has(option)) invalid("Route requires unique explicit flag/value pairs.");
    values.set(option, value);
  }
  for (const option of values.keys()) if (!new Set(["--input", "--strategy", "--host-concurrency", "--max-assignments"]).has(option)) invalid("Unknown route option.");
  const input = values.get("--input");
  if (input === undefined) invalid("Route requires --input PATH|-.");
  const strategy = values.get("--strategy");
  if (strategy !== undefined && !strategies.has(strategy as RoutingStrategy)) invalid("--strategy is not supported.");
  return Object.freeze({ input, strategy: strategy as RoutingStrategy | undefined, hostConcurrency: positive(values.get("--host-concurrency"), "--host-concurrency"), maxAssignments: positive(values.get("--max-assignments"), "--max-assignments") });
}

function contained(root: string, path: string): boolean {
  const relation = relative(root, path);
  return relation !== "" && relation !== ".." && !relation.startsWith(`..${sep}`);
}

function sameFile(
  left: Awaited<ReturnType<typeof lstat>>,
  right: Awaited<ReturnType<Awaited<ReturnType<typeof open>>["stat"]>>,
): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size
    && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

async function readTrustedQualificationAuthority(
  repositoryRoot: string,
): Promise<TrustedSemanticQualificationAuthorityForRouting> {
  const environment = localGitChildEnvironment(repositoryRoot);
  let indexedBytes: Buffer;
  try {
    const staged = await runFile("git", ["-C", repositoryRoot, "ls-files", "--stage", "--full-name", "--error-unmatch", "--", qualificationAuthorityPath], {
      encoding: "utf8",
      timeout: 5_000,
      maxBuffer: 16 * 1024,
      env: environment,
    });
    if (!/^100644 [0-9a-f]{40,64} 0\tconfig\/qualification\.json\n?$/u.test(staged.stdout)) throw new Error("unsafe-index-mode");
    const indexed = await runFile("git", ["-C", repositoryRoot, "show", `:${qualificationAuthorityPath}`], {
      encoding: "utf8",
      timeout: 5_000,
      maxBuffer: maximumAuthorityBytes,
      env: environment,
    });
    indexedBytes = Buffer.from(indexed.stdout, "utf8");
    if (indexedBytes.length > maximumAuthorityBytes) throw new Error("oversized-index-blob");
  } catch {
    throw new UsfError(
      "ROUTE_QUALIFICATION_AUTHORITY_UNCURRENT",
      exitCodes.CURRENTNESS_FAILURE,
      "Routing requires one regular indexed qualification authority blob.",
    );
  }

  const canonicalRoot = await realpath(repositoryRoot);
  const declaredPath = resolve(canonicalRoot, qualificationAuthorityPath);
  const before = await lstat(declaredPath).catch(() => undefined);
  const canonicalPath = await realpath(declaredPath).catch(() => undefined);
  if (canonicalPath === undefined || canonicalPath !== declaredPath || !contained(canonicalRoot, canonicalPath)) {
    throw new UsfError("ROUTE_QUALIFICATION_AUTHORITY_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The qualification authority file is outside the repository.");
  }
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  if (before === undefined || !before.isFile() || before.isSymbolicLink() || before.nlink !== 1
    || before.size > maximumAuthorityBytes || uid === undefined || before.uid !== uid) {
    throw new UsfError("ROUTE_QUALIFICATION_AUTHORITY_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The qualification authority must be one bounded owned regular file matching the index.");
  }
  const handle = await open(canonicalPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let bytes: Buffer;
  try {
    const opened = await handle.stat();
    if (!sameFile(before, opened)) throw new UsfError("ROUTE_QUALIFICATION_AUTHORITY_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The qualification authority changed while opening.");
    bytes = await handle.readFile();
    const after = await handle.stat();
    if (!sameFile(before, after) || bytes.length !== before.size) {
      throw new UsfError("ROUTE_QUALIFICATION_AUTHORITY_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The qualification authority changed while reading.");
    }
  } finally {
    await handle.close();
  }
  if (!bytes.equals(indexedBytes)) {
    throw new UsfError("ROUTE_QUALIFICATION_AUTHORITY_UNCURRENT", exitCodes.CURRENTNESS_FAILURE, "The qualification authority bytes do not match the indexed blob.");
  }

  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
  catch { throw new UsfError("ROUTE_QUALIFICATION_AUTHORITY_INVALID", exitCodes.CURRENTNESS_FAILURE, "The qualification authority is not valid UTF-8 JSON."); }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new UsfError("ROUTE_QUALIFICATION_AUTHORITY_INVALID", exitCodes.CURRENTNESS_FAILURE, "The qualification authority has an invalid closed shape.");
  }
  const object = value as Record<string, unknown>;
  const keys = Object.keys(object).sort();
  if (keys.length !== 3 || keys[0] !== "$schema" || keys[1] !== "policy" || keys[2] !== "suite"
    || object.$schema !== "urn:usf:qualification-config:1") {
    throw new UsfError("ROUTE_QUALIFICATION_AUTHORITY_INVALID", exitCodes.CURRENTNESS_FAILURE, "The qualification authority has an invalid closed shape.");
  }
  try {
    return Object.freeze({
      suite: createQualificationSuite(object.suite as QualificationSuiteDefinition),
      policy: createQualificationPolicy(object.policy as QualificationPolicyDefinition),
    });
  } catch {
    throw new UsfError("ROUTE_QUALIFICATION_AUTHORITY_INVALID", exitCodes.CURRENTNESS_FAILURE, "The qualification suite or policy is invalid.");
  }
}

async function readInput(repositoryRoot: string, source: string): Promise<unknown> {
  let bytes: Buffer;
  if (source === "-") {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of process.stdin) {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      total += value.length;
      if (total > maximumInputBytes) throw new UsfError("ROUTE_INPUT_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "Route stdin exceeds the bounded input size.");
      chunks.push(value);
    }
    bytes = Buffer.concat(chunks, total);
  } else {
    if (!/^\.usf\/inputs\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$/u.test(source)) {
      throw new UsfError("ROUTE_INPUT_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "Route file input must be an explicit repository-local .usf/inputs/*.json file.");
    }
    const canonicalRoot = await realpath(repositoryRoot);
    const path = resolve(canonicalRoot, source);
    if (!contained(canonicalRoot, path)) throw new UsfError("ROUTE_INPUT_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "Route input escapes the repository.");
    const before = await lstat(path).catch(() => undefined);
    const canonicalPath = await realpath(path).catch(() => undefined);
    if (canonicalPath === undefined || canonicalPath !== path || !contained(canonicalRoot, canonicalPath)) {
      throw new UsfError("ROUTE_INPUT_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "Route input resolves outside the repository.");
    }
    const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
    if (before === undefined || !before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > maximumInputBytes
      || uid === undefined || before.uid !== uid || (before.mode & 0o7777) !== 0o600) {
      throw new UsfError("ROUTE_INPUT_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "Route file input must be one owner-only mode-0600 bounded regular file.");
    }
    const handle = await open(canonicalPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const opened = await handle.stat();
      if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size || opened.mtimeMs !== before.mtimeMs || opened.ctimeMs !== before.ctimeMs) {
        throw new UsfError("ROUTE_INPUT_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "Route input changed while opening.");
      }
      bytes = await handle.readFile();
      const after = await handle.stat();
      if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || after.mtimeMs !== before.mtimeMs
        || after.ctimeMs !== before.ctimeMs || bytes.length !== before.size) {
        throw new UsfError("ROUTE_INPUT_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "Route input changed while reading.");
      }
    } finally { await handle.close(); }
  }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
  catch { throw new UsfError("ROUTE_INPUT_INVALID", exitCodes.INVALID_INPUT, "Route input must be one UTF-8 JSON object."); }
}

function routingInput(value: unknown, parsed: ParsedRouteArguments): RoutingInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new UsfError("ROUTE_INPUT_INVALID", exitCodes.INVALID_INPUT, "Route input must be an object.");
  const object = value as Record<string, unknown>;
  if (!Array.isArray(object.installedAdapters) || !Array.isArray(object.credentialNamesPresent)) {
    throw new UsfError("ROUTE_INPUT_INVALID", exitCodes.INVALID_INPUT, "Route input must encode installedAdapters and credentialNamesPresent as arrays.");
  }
  const { installedAdapters, credentialNamesPresent, strategy: inputStrategy, hostConcurrency: inputHostConcurrency, maxAssignments: inputMaxAssignments, ...rest } = object;
  if (parsed.strategy !== undefined && inputStrategy !== undefined && parsed.strategy !== inputStrategy) invalid("--strategy conflicts with the input envelope.");
  if (parsed.hostConcurrency !== undefined && inputHostConcurrency !== undefined && parsed.hostConcurrency !== inputHostConcurrency) invalid("--host-concurrency conflicts with the input envelope.");
  if (parsed.maxAssignments !== undefined && inputMaxAssignments !== undefined && parsed.maxAssignments !== inputMaxAssignments) invalid("--max-assignments conflicts with the input envelope.");
  return {
    ...rest,
    installedAdapters: new Set(installedAdapters as string[]),
    credentialNamesPresent: new Set(credentialNamesPresent as string[]),
    strategy: parsed.strategy ?? inputStrategy as RoutingStrategy,
    hostConcurrency: parsed.hostConcurrency ?? inputHostConcurrency as number,
    maxAssignments: parsed.maxAssignments ?? inputMaxAssignments as number,
  } as unknown as RoutingInput;
}

/** Local-only routing: it consumes exact facts and never invokes a provider. */
export const routeCommandHandler: CommandHandler = async ({ args, repositoryRoot }) => {
  const parsed = parse(args);
  const input = routingInput(await readInput(repositoryRoot, parsed.input), parsed);
  const trustedAuthority = await readTrustedQualificationAuthority(repositoryRoot);
  let output;
  try { output = routeWork(input, trustedAuthority); }
  catch (error) {
    throw new UsfError("ROUTE_INPUT_INVALID", exitCodes.INVALID_INPUT, "Route input does not satisfy the closed routing contract.", { reasonCode: error instanceof Error ? error.message : "unknown" });
  }
  return { output, exitCode: output.status === "ok" ? exitCodes.SUCCESS : exitCodes.NO_ELIGIBLE_ROUTE };
};
