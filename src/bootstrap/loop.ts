import { callAssignments } from "../commands/call.ts";
import { runFocusedCheck, type FocusedCheck, type FocusedCheckResult } from "../commands/check.ts";
import { resolveCommand } from "../commands/resolve.ts";
import { canonicalDigest } from "../core/canonical.ts";
import { exitCodes, UsfError } from "../core/errors.ts";
import { deriveCurrentRealisationBasis, type WorkPacket } from "../graph/work.ts";
import { isOperation, type CallAssignment, type CallBatchResult, type FakeRoute, type FileOperation as ProposalOperation } from "../providers/types.ts";
import {
  applyCandidateOperations,
  candidateScope,
  candidateOperations as realisationCandidateOperations,
  deriveCandidatePreimages,
  materialiseCandidate,
  type ByteDelta,
  type CandidateSpec,
} from "../realisation/index.ts";
import { assertBasisMatchesPacket, assertRealisationBasis, assertSameBasis, type RealisationBasis } from "../realisation/basis.ts";

export interface BootstrapProposal {
  readonly route: FakeRoute;
  readonly operations: readonly ProposalOperation[];
  readonly purpose?: "proposal" | "independence" | "freshness";
}

export interface BootstrapLoopInput {
  readonly repositoryRoot: string;
  readonly work: ProfileBoundWorkPacket;
  readonly proposals: readonly BootstrapProposal[];
  /** Selects one graph-derived required validation when a packet declares more than one. */
  readonly validationId?: string;
  readonly hostConcurrency?: number;
}

export interface BootstrapLoopResult {
  readonly schema: "urn:usf:bootstrap-loop-result:1";
  readonly status: "checked";
  readonly basis: RealisationBasis;
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

/**
 * Non-authoritative decomposition boundary used before the separate confined
 * check step. A prepared candidate is not checked, accepted, or integrated.
 */
export interface BootstrapLoopPreparation {
  readonly schema: "urn:usf:bootstrap-loop-preparation:1";
  readonly status: "candidate";
  readonly basis: RealisationBasis;
  readonly workPacketDigest: string;
  readonly calls: CallBatchResult;
  readonly resolutionDigest: string;
  readonly candidateDigest: string;
  readonly contributionDigests: readonly string[];
  readonly delta: readonly ByteDelta[];
  readonly focusedCheck: FocusedCheck;
  readonly nonclaims: readonly string[];
}

export type ProfileBoundWorkPacket = WorkPacket & Readonly<{ realisationBasis: RealisationBasis }>;

const defaultLimits = Object.freeze({
  maxTurns: 1,
  maxWallTimeMs: 1_000,
  maxInputTokens: 8_192,
  maxOutputTokens: 8_192,
  maxToolCalls: 0,
  maxRetries: 1,
});

function assignmentsFor(work: ProfileBoundWorkPacket, proposals: readonly BootstrapProposal[], basis: RealisationBasis): CallAssignment[] {
  return proposals.map((proposal) => ({
    route: proposal.route,
    basis,
    packet: {
      id: basis.work.id,
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
    workPacketDigest: basis.work.packetCoreDigest,
    promptTemplateDigest: basis.inputs.policyDigest,
    scopedDependencyDigest: basis.work.scopedDependencyDigest,
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

function writePermitted(path: string, writeSet: readonly string[]): boolean {
  return writeSet.some((entry) => entry === path || (entry.endsWith("/") && path.startsWith(entry)));
}

/**
 * Stitches route through isolated candidate materialisation without granting
 * check, primary-tree, integration, or publication authority.
 */
export async function prepareBootstrapLoop(input: BootstrapLoopInput): Promise<BootstrapLoopPreparation> {
  if (input.proposals.length === 0) {
    throw new UsfError("BOOTSTRAP_PROPOSALS_REQUIRED", exitCodes.INVALID_INPUT, "At least one proposal is required.");
  }
  if (input.work.decisionBoundary.kind !== "realisation-profile" || input.work.decisionBoundary.root === null
    || input.work.eligibility?.construction.eligible !== true) {
    throw new UsfError("BOOTSTRAP_PROFILE_BASIS_REQUIRED", exitCodes.INVALID_INPUT, "Bootstrap requires one construction-eligible profile-bound graph work packet.");
  }
  let basis: RealisationBasis;
  try {
    assertRealisationBasis(input.work.realisationBasis);
    assertBasisMatchesPacket(input.work.realisationBasis, input.work);
    basis = await deriveCurrentRealisationBasis(input.repositoryRoot, input.work.realisationBasis);
    assertSameBasis(input.work.realisationBasis, basis);
  } catch {
    throw new UsfError("BOOTSTRAP_BASIS_INVALID", exitCodes.CURRENTNESS_FAILURE, "Bootstrap requires one exact current graph-derived realisation basis.");
  }
  if (!input.work.eligibility?.construction.maximumThrough
    || !["check", "integrate", "publish", "runtime"].includes(input.work.eligibility.construction.maximumThrough)) {
    throw new UsfError("BOOTSTRAP_CHECK_CEILING_REQUIRED", exitCodes.INVALID_INPUT, "Bootstrap work must be graph-authorized through focused check.");
  }
  const focusedCheck = selectedCheck(input.work, input.validationId);
  for (const proposal of input.proposals) {
    if (proposal.operations.length === 0 || !proposal.operations.every(isOperation)) {
      throw new UsfError("BOOTSTRAP_OPERATIONS_INVALID", exitCodes.INVALID_INPUT, "Every proposal requires closed typed file operations.");
    }
    const unauthorized = proposal.operations.find((operation) => !writePermitted(operation.path, basis.scope.writeSet));
    if (unauthorized) {
      throw new UsfError("BOOTSTRAP_WRITE_UNAUTHORIZED", exitCodes.CONTAINMENT_REFUSAL, "A proposal exceeds the exact basis write set.", { path: unauthorized.path });
    }
  }
  const assignments = assignmentsFor(input.work, input.proposals, basis);
  const calls = await callAssignments(assignments, input.hostConcurrency);
  if (calls.status !== "ok") {
    throw new UsfError("BOOTSTRAP_CALL_REFUSED", exitCodes.DOMAIN_FAILURE, "Every bootstrap proposal must complete successfully.");
  }
  const resolution = resolveCommand(calls.contributions);
  if (resolution.status !== "resolved" || !resolution.candidate) {
    throw new UsfError("BOOTSTRAP_RESOLUTION_REFUSED", exitCodes.INTEGRATION_CONFLICT, "Bootstrap contributions did not resolve to one candidate.");
  }
  try {
    assertSameBasis(basis, calls.basis);
    assertSameBasis(basis, resolution.basis);
    assertSameBasis(basis, resolution.candidate.basis);
  } catch {
    throw new UsfError("BOOTSTRAP_BASIS_MIXED", exitCodes.CURRENTNESS_FAILURE, "Call and resolve must preserve the exact current realisation basis.");
  }
  const resolvedOperations = resolution.candidate.payload.operations;
  const unauthorized = resolvedOperations.find((operation) => !writePermitted(operation.path, basis.scope.writeSet));
  if (unauthorized) {
    throw new UsfError("BOOTSTRAP_WRITE_UNAUTHORIZED", exitCodes.CONTAINMENT_REFUSAL, "Resolved candidate exceeds the work packet write set.", { path: unauthorized.path });
  }
  const writeSet = [...new Set(resolvedOperations.map((operation) => operation.path))].sort();
  let preimages: Record<string, string | null>;
  try {
    preimages = await deriveCandidatePreimages(input.repositoryRoot, basis, writeSet);
  } catch {
    throw new UsfError("BOOTSTRAP_PREIMAGE_REQUIRED", exitCodes.CURRENTNESS_FAILURE, "Resolved candidate paths lack current exact basis pre-images.");
  }
  const candidateDigest = resolution.candidate.identity.artifactDigest;
  const candidateSpec: CandidateSpec = {
    digest: candidateDigest,
    basis,
    operations: resolvedOperations,
    lineage: resolution.candidate.lineage,
    scope: candidateScope(basis),
    writeSet,
    preimages,
  };
  await materialiseCandidate(input.repositoryRoot, candidateSpec);
  const delta = await applyCandidateOperations(input.repositoryRoot, candidateDigest, realisationCandidateOperations(candidateSpec));
  return Object.freeze({
    schema: "urn:usf:bootstrap-loop-preparation:1",
    status: "candidate",
    basis,
    workPacketDigest: assignments[0]!.workPacketDigest,
    calls,
    resolutionDigest: canonicalDigest(resolution, { rejectAbsolutePaths: true }),
    candidateDigest: resolution.candidate.identity.artifactDigest,
    contributionDigests: resolution.acceptedContributionDigests,
    delta,
    focusedCheck,
    nonclaims: ["not-checked", "not-integrated", "not-semantic-authority", "fake-providers-only"],
  });
}

/**
 * Composes the non-authoritative preparation with the separate confined check.
 * Integration remains a separate explicit operation after the checked byte
 * delta has been reviewed.
 */
export async function runBootstrapLoop(input: BootstrapLoopInput): Promise<BootstrapLoopResult> {
  const prepared = await prepareBootstrapLoop(input);
  const check = await runFocusedCheck(input.repositoryRoot, prepared.candidateDigest, [prepared.focusedCheck], prepared.focusedCheck.id);
  if (check.status !== "pass") {
    throw new UsfError("BOOTSTRAP_CHECK_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The isolated focused check did not pass.", { reasonCode: check.reasonCode ?? "CHECK_FAILED" });
  }
  try { assertSameBasis(prepared.basis, check.basis); }
  catch { throw new UsfError("BOOTSTRAP_CHECK_BASIS_MISMATCH", exitCodes.CURRENTNESS_FAILURE, "Focused check did not return the exact current basis."); }
  return Object.freeze({
    schema: "urn:usf:bootstrap-loop-result:1",
    status: "checked",
    basis: prepared.basis,
    workPacketDigest: prepared.workPacketDigest,
    calls: prepared.calls,
    resolutionDigest: prepared.resolutionDigest,
    candidateDigest: prepared.candidateDigest,
    contributionDigests: prepared.contributionDigests,
    delta: prepared.delta,
    check,
    claims: ["candidate-materialised-outside-primary-tree", "focused-check-passed"],
    nonclaims: ["not-integrated", "not-semantic-authority", "fake-providers-only"],
  });
}
