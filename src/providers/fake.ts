import {
  type CallAssignment, type CallFailure, type Contribution, type FakeRoute, type FileOperation,
  type Usage, contributionDigest, eligibleZeroCost, immutable, isOperation,
} from "./types.ts";

const defaultRoutes: readonly FakeRoute[] = [
  {
    requested: { family: "fake-orbit", provider: "fake-orbit-router", model: "requested-coder-v1" },
    actual: { family: "fake-orbit", provider: "fake-orbit-direct", model: "actual-coder-v2" },
    costClass: "local", observedCost: 0, concurrency: 2,
  },
  {
    requested: { family: "fake-harbor", provider: "fake-harbor-router", model: "requested-reviewer-v1" },
    actual: { family: "fake-harbor", provider: "fake-harbor-direct", model: "actual-reviewer-v3" },
    costClass: "zero-price", observedCost: 0, concurrency: 1,
  },
];

export function fakeProviderRoutes(): readonly FakeRoute[] {
  return immutable(defaultRoutes.map((route) => ({ ...route, requested: { ...route.requested }, actual: { ...route.actual } })));
}

export function validateProposalOperations(operations: readonly FileOperation[], permittedPaths: readonly string[]): string | null {
  for (const operation of operations) {
    if (!isOperation(operation)) return "MALFORMED_FILE_OPERATION";
    if (!permittedPaths.includes(operation.path)) return "OPERATION_OUTSIDE_SCOPE";
  }
  return null;
}

export class DeterministicFakeProvider {
  #failedOnce = false;
  readonly route: FakeRoute;

  constructor(route: FakeRoute) { this.route = immutable({ ...route, requested: { ...route.requested }, actual: { ...route.actual } }); }

  invoke(assignment: CallAssignment, retries = 0): Contribution | CallFailure {
    if (!eligibleZeroCost(this.route)) return { route: this.route.requested, reasonCode: "ZERO_COST_POLICY_REFUSAL", retryable: false };
    if (this.route.failure === "always" || (this.route.failure === "once" && !this.#failedOnce)) {
      this.#failedOnce = true;
      return { route: this.route.requested, reasonCode: "FAKE_PROVIDER_INJECTED_FAILURE", retryable: this.route.failure === "once" };
    }
    const operationError = validateProposalOperations(assignment.packet.proposedFileOperations, assignment.packet.permittedPaths);
    if (operationError) return { route: this.route.requested, reasonCode: operationError, retryable: false };
    const operations = assignment.packet.proposedFileOperations.map((operation) => ({ ...operation }));
    const outputTokens = Math.min(assignment.limits.maxOutputTokens, Math.max(1, operations.reduce((sum, operation) => sum + (operation.content?.length ?? 1), 0)));
    const usage: Usage = { inputTokens: Math.min(assignment.limits.maxInputTokens, assignment.packet.objective.length), outputTokens, toolCalls: 0, retries };
    const basis = {
      assignment: { workPacketDigest: assignment.workPacketDigest, promptTemplateDigest: assignment.promptTemplateDigest, scopedDependencyDigest: assignment.scopedDependencyDigest, purpose: assignment.purpose ?? "proposal" },
      requested: this.route.requested, actual: this.route.actual, cost: { costClass: this.route.costClass, observedCost: this.route.observedCost, evidence: "fake-route-fixed-zero-cost" }, usage,
      payload: { operations },
    };
    return immutable({
      schema: "urn:usf:contribution:1", kind: "contribution", identity: { artifactDigest: contributionDigest(basis) },
      ...basis, limits: { ...assignment.limits },
      claims: ["structured-file-operations-proposed"],
      nonclaims: ["not-validated", "not-accepted", "not-written-to-repository"],
    });
  }
}
