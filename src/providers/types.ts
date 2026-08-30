import { canonicalDigest, canonicalJson as coreCanonicalJson } from "../core/canonical.ts";
import { isRepositoryRelativePath } from "../core/scope.ts";
import type { ArtifactProjection, DecisionBoundary, RequirementProjection, WorkPacket } from "../graph/work.ts";

export { isRepositoryRelativePath };

export type CostClass = "local" | "zero-price" | "free-quota" | "subscription" | "paid" | "unknown";

export interface ProviderIdentity {
  family: string;
  provider: string;
  model: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  toolCalls: number;
  retries: number;
}

export interface FileOperation {
  kind: "write" | "delete";
  path: string;
  content?: string;
  encoding?: "utf8" | "base64";
  mediaType?: string;
  expectedDigest?: string;
}

export interface WorkPacketForProposal {
  id: string;
  objective: string;
  permittedPaths: readonly string[];
  decisionBoundary: DecisionBoundary;
  requirements: readonly RequirementProjection[];
  artifacts: readonly ArtifactProjection[];
  readSet: readonly string[];
  constraints: readonly string[];
  acceptanceCriteria: WorkPacket["acceptanceCriteria"];
  validationPlan: WorkPacket["validationPlan"];
  proofObligations: WorkPacket["proofObligations"];
  modelCapabilities: readonly string[];
  privacy: WorkPacket["privacy"];
  environmentPosture: WorkPacket["environmentPosture"];
  targetRuntimeProvider: string;
  constructionRouteConstraints: readonly string[];
  outputSchema: string;
  stopConditions: readonly string[];
  proposedFileOperations: readonly FileOperation[];
}

export interface CallLimits {
  maxTurns: number;
  maxWallTimeMs: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxToolCalls: number;
  maxRetries: number;
}

export interface FakeRoute {
  requested: ProviderIdentity;
  actual: ProviderIdentity;
  costClass: CostClass;
  observedCost: number | null;
  concurrency: number;
  failure?: "always" | "once";
}

export interface Contribution {
  schema: "urn:usf:contribution:1";
  kind: "contribution";
  identity: { artifactDigest: string };
  assignment: {
    workPacketDigest: string;
    promptTemplateDigest: string;
    scopedDependencyDigest: string;
    purpose: "proposal" | "independence" | "freshness";
  };
  requested: ProviderIdentity;
  actual: ProviderIdentity;
  cost: { costClass: CostClass; observedCost: number | null; evidence: string };
  usage: Usage;
  limits: CallLimits;
  payload: { operations: readonly FileOperation[] };
  claims: readonly string[];
  nonclaims: readonly string[];
}

export interface CallFailure {
  route: ProviderIdentity;
  reasonCode: string;
  retryable: boolean;
}

export interface CallBatchResult {
  schema: "urn:usf:call-result:1";
  status: "ok" | "partial" | "refused";
  contributions: readonly Contribution[];
  failures: readonly CallFailure[];
  metrics: { requested: number; succeeded: number; failed: number; observedCost: number };
}

export interface CallAssignment {
  route: FakeRoute;
  packet: WorkPacketForProposal;
  workPacketDigest: string;
  promptTemplateDigest: string;
  scopedDependencyDigest: string;
  limits: CallLimits;
  purpose?: "proposal" | "independence" | "freshness";
}

export function canonicalJson(value: unknown): string {
  return coreCanonicalJson(value, { rejectAbsolutePaths: true });
}

export function digest(value: unknown): string {
  return canonicalDigest(value, { rejectAbsolutePaths: true });
}

export function immutable<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const item of Object.values(value as Record<string, unknown>)) immutable(item);
  }
  return value;
}

export function isOperation(value: unknown): value is FileOperation {
  if (!value || typeof value !== "object") return false;
  const operation = value as Partial<FileOperation>;
  if ((operation.kind !== "write" && operation.kind !== "delete") || typeof operation.path !== "string" || !isRepositoryRelativePath(operation.path)) return false;
  if (operation.kind === "write") {
    if (typeof operation.content !== "string" || (operation.encoding !== undefined && operation.encoding !== "utf8" && operation.encoding !== "base64")) return false;
    if (operation.encoding === "base64" && !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(operation.content)) return false;
    if (operation.mediaType !== undefined && (typeof operation.mediaType !== "string" || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(operation.mediaType))) return false;
    return true;
  }
  return operation.content === undefined && operation.encoding === undefined && operation.mediaType === undefined;
}

export function eligibleZeroCost(route: FakeRoute): boolean {
  return (route.costClass === "local" || route.costClass === "zero-price" || route.costClass === "free-quota") && route.observedCost === 0;
}

export function contributionDigest(contribution: Pick<Contribution, "assignment" | "requested" | "actual" | "cost" | "usage" | "payload">): string {
  return digest({ assignment: contribution.assignment, requested: contribution.requested, actual: contribution.actual, cost: contribution.cost, usage: contribution.usage, payload: contribution.payload });
}
