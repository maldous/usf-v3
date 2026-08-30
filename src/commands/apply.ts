import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import type { Candidate as ResolvedCandidate, Resolution } from "../collaboration/resolve.ts";
import { exitCodes, type ExitCode, UsfError } from "../core/errors.ts";
import { isOperation } from "../providers/types.ts";
import {
  applyCandidateOperations,
  candidateOperations,
  candidateScope,
  deriveCandidatePreimages,
  integrateCandidates,
  IntegrationError,
  materialiseCandidate,
  prepareCandidateIntegration,
  RealisationError,
  stableReason,
} from "../realisation/index.ts";
import type { CandidateSpec } from "../realisation/index.ts";
import { parseRealisationBasis, type RealisationBasis } from "../realisation/basis.ts";
import { checkHandler, runGraphDerivedCheck } from "./check.ts";
import type { CommandHandler } from "./dispatcher.ts";

export interface ApplyInput { readonly candidate: CandidateSpec; }
export type ApplyResult = { readonly status: "applied"; readonly basis: RealisationBasis; readonly workspace: string; readonly delta: Awaited<ReturnType<typeof applyCandidateOperations>> } | { readonly status: "refused"; readonly reasonCode: string };

const maximumApplyInputBytes = 4 * 1024 * 1024;
const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const ignoredInputPattern = /^\.usf\/inputs\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$/u;

export type ApplyArguments =
  | Readonly<{ mode: "input"; source: string }>
  | Readonly<{ mode: "legacy-inline"; json: string }>;

export type CheckArguments =
  | Readonly<{ mode: "graph-derived"; candidateDigest: string; validationId: string }>
  | Readonly<{ mode: "legacy"; args: readonly [string, string, string] }>;

export interface IntegrateArguments {
  readonly candidateDigests: readonly string[];
  readonly dryRun: boolean;
}

const reasonCodeExitGroups = Object.freeze([
  Object.freeze({ exitCode: exitCodes.DOMAIN_FAILURE, reasonCodes: Object.freeze([
    "CHECK_FAILED", "CHECK_TIMEOUT", "INTEGRATION_GIT_FAILED", "INTEGRATION_TIMEOUT", "INTEGRATION_VALIDATION_FAILED", "INTEGRATION_VALIDATION_TIMEOUT",
  ]) }),
  Object.freeze({ exitCode: exitCodes.INVALID_INPUT, reasonCodes: Object.freeze([
    "APPLY_ARGUMENTS_INVALID", "APPLY_CANDIDATE_INVALID", "APPLY_INPUT_INVALID", "CHECK_ARGUMENTS_INVALID", "INVALID_CANDIDATE_DIGEST",
    "INVALID_OPERATION", "INVALID_REALISATION_BASIS", "INTEGRATE_ARGUMENTS_INVALID", "INTEGRATE_COHORT_INVALID", "INTEGRATION_CANDIDATE_COUNT_INVALID",
    "CHECK_VALIDATION_COMMAND_UNSUPPORTED", "CHECK_VALIDATION_MODE_UNSUPPORTED", "CHECK_VALIDATION_TOOL_UNSUPPORTED",
  ]) }),
  Object.freeze({ exitCode: exitCodes.EXTERNAL_UNAVAILABLE, reasonCodes: Object.freeze([
    "CHECK_CONFINEMENT_UNAVAILABLE", "CHECK_DEPENDENCY_UNAVAILABLE", "CHECK_TOOL_UNAVAILABLE", "INTEGRATION_CONFINEMENT_UNAVAILABLE",
    "INTEGRATION_DEPENDENCY_UNAVAILABLE", "INTEGRATION_GIT_UNAVAILABLE", "INTEGRATION_TOOL_UNAVAILABLE",
  ]) }),
  Object.freeze({ exitCode: exitCodes.CURRENTNESS_FAILURE, reasonCodes: Object.freeze([
    "CANDIDATE_BASIS_MISMATCH", "INVALID_WORKSPACE_MANIFEST", "MISSING_WORKSPACE", "STALE_REALISATION_BASIS", "STALE_RELEVANT_PREIMAGE",
    "CHECK_RECEIPT_AUTHORITY_INVALID", "CHECK_RECEIPT_INVALID", "CHECK_RECEIPT_MISSING", "CHECK_RECEIPT_READBACK_MISMATCH",
    "CHECK_VALIDATION_AUTHORITY_INVALID", "CHECK_VALIDATION_NOT_BOUND", "CHECK_VALIDATION_SCHEMA_INVALID", "CHECK_VALIDATION_TOOL_INVALID",
    "INTEGRATION_AUTHORITY_INVALID", "INTEGRATION_CHECK_RECEIPT_INVALID", "INTEGRATION_CHECK_RECEIPT_MISSING", "INTEGRATION_INTENT_MISMATCH",
    "INTEGRATION_DETACHED_BASIS_MISMATCH", "INTEGRATION_POSTIMAGE_BASIS_INVALID", "INTEGRATION_POSTIMAGE_MOVED", "INTEGRATION_PRIMARY_MARKER_MISMATCH",
    "INTEGRATION_PRIMARY_MOVED", "INTEGRATION_RECOVERY_QUARANTINED", "INTEGRATION_STALE_PREIMAGE", "INTEGRATION_TEMP_REF_INVALID",
    "INTEGRATION_VALIDATION_INVALID",
  ]) }),
  Object.freeze({ exitCode: exitCodes.CONTAINMENT_REFUSAL, reasonCodes: Object.freeze([
    "ABSOLUTE_PATH", "APPLY_INPUT_REFUSED", "CANDIDATE_LOCK_UNAVAILABLE", "CHECK_CANDIDATE_TREE_LIMIT_EXCEEDED", "CHECK_NOT_ALLOWLISTED",
    "CHECK_OUTPUT_LIMIT_EXCEEDED", "CHECK_RECEIPT_PATH_UNSAFE", "CONTROL_PATH", "INTEGRATION_DRY_RUN_PRIMARY_MUTATED", "INTEGRATION_FILTER_ATTRIBUTE",
    "INTEGRATION_LOCK_UNAVAILABLE", "INTEGRATION_PRIVATE_STATE_UNSAFE", "INTEGRATION_SYMLINK_OR_NONREGULAR", "INTEGRATION_UNDECLARED_EFFECT",
    "PATH_TRAVERSAL", "SYMLINK_ESCAPE", "UNDECLARED_WRITE",
  ]) }),
  Object.freeze({ exitCode: exitCodes.NO_ELIGIBLE_ROUTE, reasonCodes: Object.freeze([
    "NO_ELIGIBLE_ROUTE", "NO_ELIGIBLE_ZERO_COST_ROUTE", "NO_ELIGIBLE_ZERO_PAID_COST_ROUTE",
  ]) }),
  Object.freeze({ exitCode: exitCodes.INTEGRATION_CONFLICT, reasonCodes: Object.freeze([
    "CANDIDATE_BUSY", "CHECK_RECEIPT_CONFLICT", "INTEGRATION_CALLER_ORDER_INVALID", "INTEGRATION_DUPLICATE_CANDIDATE",
    "INTEGRATION_DUPLICATE_RECEIPT", "INTEGRATION_DUPLICATE_WORK", "INTEGRATION_EMPTY_DELTA", "INTEGRATION_LOCK_BUSY",
    "INTEGRATION_OVERLAPPING_WRITE_SET", "INTEGRATION_PRIMARY_TOUCHED_PATH_DIRTY", "INTEGRATION_PROFILE_MISMATCH",
  ]) }),
] as const);

/** One stable GOAL.md section 11 reason-to-process-exit boundary. */
export function exitCodeForReason(reasonCode: string): ExitCode {
  return reasonCodeExitGroups.find((group) => (group.reasonCodes as readonly string[]).includes(reasonCode))?.exitCode
    ?? exitCodes.DOMAIN_FAILURE;
}

function invalid(code: string, message: string): never {
  throw new UsfError(code, exitCodeForReason(code), message);
}

function contained(root: string, path: string): boolean {
  const relation = relative(root, path);
  return relation !== "" && relation !== ".." && !relation.startsWith(`..${sep}`);
}

function sameFile(left: Awaited<ReturnType<typeof lstat>>, right: Awaited<ReturnType<Awaited<ReturnType<typeof open>>["stat"]>>): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size
    && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

export function parseApplyArguments(args: readonly string[]): ApplyArguments {
  if (args.length === 2 && args[0] === "--input" && args[1] !== "") return Object.freeze({ mode: "input", source: args[1]! });
  if (args.length === 1 && !args[0]!.startsWith("--")) {
    if (Buffer.byteLength(args[0]!, "utf8") > maximumApplyInputBytes) invalid("APPLY_INPUT_REFUSED", "Inline apply input exceeds the bounded input size.");
    return Object.freeze({ mode: "legacy-inline", json: args[0]! });
  }
  return invalid("APPLY_ARGUMENTS_INVALID", "Apply requires --input PATH|-; one bounded inline JSON argument remains accepted for compatibility.");
}

export function parseCheckArguments(args: readonly string[]): CheckArguments {
  if (args.length === 3 && !args[0]!.startsWith("--")) return Object.freeze({ mode: "legacy", args: Object.freeze([...args]) as unknown as readonly [string, string, string] });
  if (args.length !== 4) return invalid("CHECK_ARGUMENTS_INVALID", "Check requires --candidate DIGEST --validation IRI.");
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index]!;
    const value = args[index + 1]!;
    if (!["--candidate", "--validation"].includes(option) || value.length === 0 || values.has(option)) {
      return invalid("CHECK_ARGUMENTS_INVALID", "Check requires unique --candidate and --validation options.");
    }
    values.set(option, value);
  }
  const candidateDigest = values.get("--candidate");
  const validationId = values.get("--validation");
  if (candidateDigest === undefined || !digestPattern.test(candidateDigest) || validationId === undefined || !/^urn:[^<>\s]+$/u.test(validationId)) {
    return invalid("CHECK_ARGUMENTS_INVALID", "Check requires one sha256 candidate digest and one validation IRI.");
  }
  return Object.freeze({ mode: "graph-derived", candidateDigest, validationId });
}

export function parseIntegrateArguments(args: readonly string[]): IntegrateArguments {
  const candidateDigests: string[] = [];
  let dryRun = false;
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index]!;
    if (option === "--dry-run") {
      if (dryRun) return invalid("INTEGRATE_ARGUMENTS_INVALID", "--dry-run may appear only once.");
      dryRun = true;
      continue;
    }
    if (option !== "--candidate") return invalid("INTEGRATE_ARGUMENTS_INVALID", "Integrate accepts only repeated --candidate DIGEST and optional --dry-run.");
    const value = args[++index];
    if (value === undefined || !digestPattern.test(value)) return invalid("INTEGRATE_ARGUMENTS_INVALID", "Every --candidate requires one sha256 digest.");
    candidateDigests.push(value);
  }
  if (candidateDigests.length < 1 || candidateDigests.length > 32 || new Set(candidateDigests).size !== candidateDigests.length) {
    return invalid("INTEGRATE_COHORT_INVALID", "Integrate requires 1 through 32 distinct candidate digests.");
  }
  return Object.freeze({ candidateDigests: Object.freeze(candidateDigests), dryRun });
}

async function readApplyInput(repositoryRoot: string, request: ApplyArguments): Promise<unknown> {
  let bytes: Buffer;
  if (request.mode === "legacy-inline") bytes = Buffer.from(request.json, "utf8");
  else if (request.source === "-") {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of process.stdin) {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      total += value.length;
      if (total > maximumApplyInputBytes) throw new UsfError("APPLY_INPUT_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "Apply stdin exceeds the bounded input size.");
      chunks.push(value);
    }
    bytes = Buffer.concat(chunks, total);
  } else {
    if (!ignoredInputPattern.test(request.source)) {
      throw new UsfError("APPLY_INPUT_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "Apply file input must be one explicit repository-local .usf/inputs/*.json file.");
    }
    const canonicalRoot = await realpath(repositoryRoot);
    const path = resolve(canonicalRoot, request.source);
    const before = await lstat(path).catch(() => undefined);
    const canonicalPath = await realpath(path).catch(() => undefined);
    const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
    if (before === undefined || canonicalPath === undefined || canonicalPath !== path || !contained(canonicalRoot, canonicalPath)
      || !before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > maximumApplyInputBytes
      || uid === undefined || before.uid !== uid || (before.mode & 0o7777) !== 0o600) {
      throw new UsfError("APPLY_INPUT_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "Apply file input must be one bounded owner-only regular file within the repository.");
    }
    const handle = await open(canonicalPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const opened = await handle.stat();
      if (!sameFile(before, opened)) throw new UsfError("APPLY_INPUT_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "Apply input changed while opening.");
      bytes = await handle.readFile();
      if (!sameFile(before, await handle.stat()) || bytes.length !== before.size) {
        throw new UsfError("APPLY_INPUT_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "Apply input changed while reading.");
      }
    } finally {
      await handle.close();
    }
  }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
  catch { throw new UsfError("APPLY_INPUT_INVALID", exitCodes.INVALID_INPUT, "Apply input must be one bounded UTF-8 JSON value."); }
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function publicCandidate(value: unknown): ResolvedCandidate | undefined {
  const input = object(value);
  if (input?.schema === "urn:usf:resolve-result:1") {
    const resolution = input as unknown as Resolution;
    if (resolution.status !== "resolved" || resolution.candidate === null) return undefined;
    return resolution.candidate;
  }
  if (input?.schema === "urn:usf:candidate:1" && input.kind === "candidate" && input.status === "resolved") return input as unknown as ResolvedCandidate;
  return undefined;
}

async function applyInput(root: string, value: unknown): Promise<ApplyInput> {
  const envelope = object(value);
  const candidate = publicCandidate(value);
  if (candidate !== undefined) {
    const basis = parseRealisationBasis(candidate.basis);
    const operations = candidate.payload?.operations;
    if (!digestPattern.test(candidate.identity?.artifactDigest ?? "") || candidate.identity?.basisDigest !== basis.basisDigest
      || !Array.isArray(operations) || !operations.every(isOperation)
      || !Array.isArray(candidate.lineage?.acceptedContributionDigests) || !Array.isArray(candidate.lineage?.rejected)) {
      throw new UsfError("APPLY_CANDIDATE_INVALID", exitCodes.INVALID_INPUT, "Resolved candidate envelope is incomplete.");
    }
    const writeSet = [...new Set(operations.map((operation) => operation.path))].sort();
    return Object.freeze({ candidate: Object.freeze({
      digest: candidate.identity.artifactDigest,
      basis,
      operations: Object.freeze(operations.map((operation) => Object.freeze({ ...operation }))),
      lineage: Object.freeze({ acceptedContributionDigests: Object.freeze([...candidate.lineage.acceptedContributionDigests]), rejected: Object.freeze([...candidate.lineage.rejected]) }),
      scope: Object.freeze(candidateScope(basis)),
      writeSet: Object.freeze(writeSet),
      preimages: Object.freeze(await deriveCandidatePreimages(root, basis, writeSet)),
    }) });
  }
  const legacy = object(envelope?.candidate);
  if (legacy === undefined) throw new UsfError("APPLY_CANDIDATE_INVALID", exitCodes.INVALID_INPUT, "Apply input must be a resolved candidate, resolve result, or compatible legacy apply envelope.");
  const basis = parseRealisationBasis(legacy.basis);
  return Object.freeze({ candidate: Object.freeze({ ...legacy, basis }) as unknown as CandidateSpec });
}

/** Command-facing wrapper. It deliberately has no primary-tree write path. */
export async function apply(root: string, input: ApplyInput): Promise<ApplyResult> {
  try {
    const resolvedRoot = await realpath(root);
    const materialised = await materialiseCandidate(resolvedRoot, input.candidate);
    const delta = await applyCandidateOperations(resolvedRoot, input.candidate.digest, candidateOperations(input.candidate));
    return { status: "applied", basis: materialised.basis, workspace: materialised.workspace, delta };
  } catch (error) {
    return { status: "refused", reasonCode: stableReason(error) ?? "INVALID_OPERATION" };
  }
}

/** `usf apply --input PATH|-`; the single inline JSON argument remains compatible. */
export const applyHandler: CommandHandler = async ({ args, repositoryRoot }) => {
  try {
    const request = parseApplyArguments(args);
    const input = await applyInput(repositoryRoot, await readApplyInput(repositoryRoot, request));
    const result = await apply(repositoryRoot, input);
    const output = result.status === "applied"
      ? { schema: "urn:usf:apply-result:1", ...result, workspace: `.usf/workspaces/${input.candidate.digest.slice("sha256:".length)}` }
      : { schema: "urn:usf:apply-result:1", ...result };
    return { output, exitCode: result.status === "applied" ? exitCodes.SUCCESS : exitCodeForReason(result.reasonCode) };
  } catch (error) {
    const reasonCode = error instanceof UsfError ? error.code : stableReason(error) ?? "APPLY_CANDIDATE_INVALID";
    return {
      output: { schema: "urn:usf:apply-result:1", status: "refused", reasonCode },
      exitCode: exitCodeForReason(reasonCode),
    };
  }
};

/** New graph-derived receipt path plus the still-supported confined bootstrap form. */
export const admissionCheckHandler: CommandHandler = async (request) => {
  const parsed = parseCheckArguments(request.args);
  if (parsed.mode === "legacy") {
    const legacy = await checkHandler({ ...request, args: parsed.args });
    const output = object(legacy.output);
    return output?.status === "refused" && typeof output.reasonCode === "string"
      ? { ...legacy, exitCode: exitCodeForReason(output.reasonCode) }
      : legacy;
  }
  const result = await runGraphDerivedCheck(request.repositoryRoot, parsed.candidateDigest, parsed.validationId);
  return {
    output: { schema: "urn:usf:check-result:1", ...result },
    exitCode: result.status === "pass" ? exitCodes.SUCCESS : exitCodeForReason(result.reasonCode),
  };
};

/** Explicit dry-run preparation or one local observation-only integration. */
export const integrateCommandHandler: CommandHandler = async ({ args, repositoryRoot }) => {
  const parsed = parseIntegrateArguments(args);
  try {
    const output = parsed.dryRun
      ? await prepareCandidateIntegration(repositoryRoot, { candidateDigests: parsed.candidateDigests })
      : await integrateCandidates(repositoryRoot, { candidateDigests: parsed.candidateDigests });
    return { output, exitCode: exitCodes.SUCCESS };
  } catch (error) {
    const reasonCode = error instanceof IntegrationError ? error.reasonCode : stableReason(error) ?? "INTEGRATION_VALIDATION_INVALID";
    return {
      output: {
        schema: "urn:usf:integrate-result:1",
        status: "refused",
        reasonCode,
        candidateDigests: parsed.candidateDigests,
        dryRun: parsed.dryRun,
        nonClaims: [
          "no-integration-observation-created",
          "no-evidence-proof-publication-or-completion-effect",
          "no-github-push-provider-runtime-staging-or-production-effect",
        ],
      },
      exitCode: exitCodeForReason(reasonCode),
    };
  }
};

export { RealisationError };
