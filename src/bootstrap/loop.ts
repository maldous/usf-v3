import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { callAssignments } from "../commands/call.ts";
import { runFocusedCheck, type FocusedCheck, type FocusedCheckResult } from "../commands/check.ts";
import { resolveCommand } from "../commands/resolve.ts";
import { canonicalDigest } from "../core/canonical.ts";
import { exitCodes, UsfError } from "../core/errors.ts";
import type { WorkPacket } from "../graph/work.ts";
import type { CallAssignment, CallBatchResult, FakeRoute, FileOperation as ProposalOperation } from "../providers/index.ts";
import {
  applyCandidateOperations,
  encodeBytes,
  materialiseCandidate,
  type ByteDelta,
  type CandidateSpec,
  type FileOperation as RealisationOperation,
} from "../realisation/index.ts";

export interface BootstrapProposal {
  readonly route: FakeRoute;
  readonly operations: readonly ProposalOperation[];
  readonly purpose?: "proposal" | "independence" | "freshness";
}

export interface BootstrapLoopInput {
  readonly repositoryRoot: string;
  readonly work: WorkPacket;
  readonly proposals: readonly BootstrapProposal[];
  /** Selects one graph-derived required validation when a packet declares more than one. */
  readonly validationId?: string;
  readonly hostConcurrency?: number;
}

export interface BootstrapLoopResult {
  readonly schema: "urn:usf:bootstrap-loop-result:1";
  readonly status: "checked";
  readonly workPacketDigest: string;
  readonly calls: CallBatchResult;
  readonly resolutionDigest: string;
  readonly candidateDigest: string;
  readonly contributionDigests: readonly string[];
  readonly delta: readonly ByteDelta[];
  readonly check: FocusedCheckResult;
  readonly claims: readonly string[];
  readonly nonclaims: readonly string[];
}

const defaultLimits = Object.freeze({
  maxTurns: 1,
  maxWallTimeMs: 1_000,
  maxInputTokens: 8_192,
  maxOutputTokens: 8_192,
  maxToolCalls: 0,
  maxRetries: 1,
});

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function preimage(root: string, path: string): Promise<string | null> {
  try {
    return sha256Hex(await readFile(resolve(root, path)));
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function toRealisationOperation(operation: ProposalOperation): RealisationOperation {
  return operation.kind === "write"
    ? { kind: "write", path: operation.path, bytes: operation.encoding === "base64" ? operation.content ?? "" : encodeBytes(operation.content ?? "") }
    : { kind: "delete", path: operation.path };
}

function assignmentsFor(work: WorkPacket, proposals: readonly BootstrapProposal[]): CallAssignment[] {
  const workPacketDigest = canonicalDigest(work, { rejectAbsolutePaths: true });
  const promptTemplateDigest = canonicalDigest({
    schema: "urn:usf:bootstrap-prompt-template:1",
    objective: work.objective,
    outputSchema: work.outputSchema,
    stopConditions: work.stopConditions,
  });
  return proposals.map((proposal) => ({
    route: proposal.route,
    packet: {
      id: work.id,
      objective: work.objective,
      permittedPaths: work.writeSet,
      decisionBoundary: work.decisionBoundary,
      requirements: work.requirements,
      artifacts: work.artifacts,
      readSet: work.readSet,
      constraints: work.constraints,
      acceptanceCriteria: work.acceptanceCriteria,
      validationPlan: work.validationPlan,
      proofObligations: work.proofObligations,
      modelCapabilities: work.modelCapabilities,
      privacy: work.privacy,
      environmentPosture: work.environmentPosture,
      targetRuntimeProvider: work.targetRuntimeProvider,
      constructionRouteConstraints: work.constructionRouteConstraints,
      outputSchema: work.outputSchema,
      stopConditions: work.stopConditions,
      proposedFileOperations: proposal.operations,
    },
    workPacketDigest,
    promptTemplateDigest,
    scopedDependencyDigest: work.scopedDependencyDigest,
    limits: defaultLimits,
    purpose: proposal.purpose,
  }));
}

function selectedCheck(work: WorkPacket, validationId: string | undefined): FocusedCheck {
  const required = work.validationPlan.filter((validation) => validation.applicability === "required");
  const validation = validationId === undefined
    ? required.length === 1 ? required[0] : undefined
    : required.find((candidate) => candidate.id === validationId);
  if (!validation) {
    throw new UsfError("BOOTSTRAP_VALIDATION_REQUIRED", exitCodes.INVALID_INPUT, "Select exactly one required graph-derived validation obligation.");
  }
  if (!work.environmentPosture.some((posture) => posture.environment === validation.environment && posture.applicability === "required")) {
    throw new UsfError("BOOTSTRAP_VALIDATION_ENVIRONMENT_REFUSED", exitCodes.INVALID_INPUT, "The selected validation environment is not required by the contract.");
  }
  const command = validation.command.split(" ");
  if (command.join(" ") !== validation.command || command[0] !== "node" || command.length < 2 || command.some((argument) => !/^[A-Za-z0-9_./:@=+-]+$/.test(argument))) {
    throw new UsfError("BOOTSTRAP_VALIDATION_COMMAND_REFUSED", exitCodes.INVALID_INPUT, "Bootstrap validation must be a literal shell-free Node command.");
  }
  return { id: validation.id, command };
}

function candidateScope(work: WorkPacket): string[] {
  return [...new Set([...work.readSet, ...work.writeSet].map((path) => path.endsWith("/") ? path.slice(0, -1) : path))].sort();
}

/**
 * Stitches the Gate 1 construction path without granting primary-tree authority.
 * Integration remains a separate, explicit operation after the checked byte delta
 * has been reviewed.
 */
export async function runBootstrapLoop(input: BootstrapLoopInput): Promise<BootstrapLoopResult> {
  if (input.proposals.length === 0) {
    throw new UsfError("BOOTSTRAP_PROPOSALS_REQUIRED", exitCodes.INVALID_INPUT, "At least one proposal is required.");
  }
  const assignments = assignmentsFor(input.work, input.proposals);
  const calls = await callAssignments(assignments, input.hostConcurrency);
  if (calls.status !== "ok") {
    throw new UsfError("BOOTSTRAP_CALL_REFUSED", exitCodes.DOMAIN_FAILURE, "Every bootstrap proposal must complete successfully.");
  }
  const resolution = resolveCommand(calls.contributions);
  if (resolution.status !== "resolved" || !resolution.candidate) {
    throw new UsfError("BOOTSTRAP_RESOLUTION_REFUSED", exitCodes.INTEGRATION_CONFLICT, "Bootstrap contributions did not resolve to one candidate.");
  }
  const candidateOperations = resolution.candidate.payload.operations;
  const unauthorized = candidateOperations.find((operation) => !input.work.writeSet.includes(operation.path));
  if (unauthorized) {
    throw new UsfError("BOOTSTRAP_WRITE_UNAUTHORIZED", exitCodes.CONTAINMENT_REFUSAL, "Resolved candidate exceeds the work packet write set.", { path: unauthorized.path });
  }
  const realisationOperations = candidateOperations.map(toRealisationOperation);
  const writeSet = [...new Set(realisationOperations.map((operation) => operation.path))].sort();
  const preimages = Object.fromEntries(await Promise.all(writeSet.map(async (path) => [path, await preimage(input.repositoryRoot, path)] as const)));
  const candidateDigest = resolution.candidate.identity.artifactDigest.replace(/^sha256:/, "");
  const candidateSpec: CandidateSpec = {
    digest: candidateDigest,
    scope: candidateScope(input.work),
    writeSet,
    preimages,
  };
  await materialiseCandidate(input.repositoryRoot, candidateSpec);
  const delta = await applyCandidateOperations(input.repositoryRoot, candidateDigest, realisationOperations);
  const focusedCheck = selectedCheck(input.work, input.validationId);
  const check = await runFocusedCheck(input.repositoryRoot, candidateDigest, [focusedCheck], focusedCheck.id);
  if (check.status !== "pass") {
    throw new UsfError("BOOTSTRAP_CHECK_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The isolated focused check did not pass.", { reasonCode: check.reasonCode ?? "CHECK_FAILED" });
  }
  return Object.freeze({
    schema: "urn:usf:bootstrap-loop-result:1",
    status: "checked",
    workPacketDigest: assignments[0]!.workPacketDigest,
    calls,
    resolutionDigest: canonicalDigest(resolution, { rejectAbsolutePaths: true }),
    candidateDigest: resolution.candidate.identity.artifactDigest,
    contributionDigests: resolution.acceptedContributionDigests,
    delta,
    check,
    claims: ["candidate-materialised-outside-primary-tree", "focused-check-passed"],
    nonclaims: ["not-integrated", "not-semantic-authority", "fake-providers-only"],
  });
}
