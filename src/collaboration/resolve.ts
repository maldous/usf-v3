import { type Contribution, type FileOperation, contributionDigest, digest, immutable, isOperation } from "../providers/types.ts";
import { canonicalDigest } from "../core/canonical.ts";
import { assertRealisationBasis, assertSameBasis, type RealisationBasis } from "../realisation/basis.ts";
import { parseLocalContribution, type LocalContribution } from "./local-contribution.ts";

export type ResolvableContribution = Contribution | LocalContribution;

export interface Candidate {
  schema: "urn:usf:candidate:1";
  kind: "candidate";
  status: "resolved";
  identity: { artifactDigest: string; basisDigest: string };
  basis: RealisationBasis;
  payload: { operations: readonly FileOperation[] };
  lineage: { acceptedContributionDigests: readonly string[]; rejected: readonly ResolutionRejection[] };
  claims: readonly string[];
  nonclaims: readonly string[];
}

export interface ResolutionRejection { contributionDigest: string | null; reasonCode: string; path?: string; }
export interface Resolution {
  schema: "urn:usf:resolve-result:1";
  basis: RealisationBasis;
  status: "resolved" | "refused";
  candidate: Candidate | null;
  acceptedContributionDigests: readonly string[];
  rejected: readonly ResolutionRejection[];
}

function contributionOperations(contribution: ResolvableContribution): FileOperation[] | ResolutionRejection {
  if (contribution.schema === "urn:usf:local-contribution:1") {
    try { return parseLocalContribution(contribution).payload.operations.map(operation => ({ ...operation })); }
    catch { return { contributionDigest: contribution.identity?.artifactDigest ?? null, reasonCode: "LOCAL_CONTRIBUTION_INTEGRITY_FAILURE" }; }
  }
  const operations = contribution.payload?.operations;
  if (!Array.isArray(operations) || !operations.every(isOperation)) return { contributionDigest: contribution.identity?.artifactDigest ?? null, reasonCode: "MALFORMED_FILE_OPERATION" };
  if (contribution.schema !== "urn:usf:contribution:1" || contribution.kind !== "contribution" || !contribution.identity?.artifactDigest
    || contribution.identity.artifactDigest !== contributionDigest(contribution)
    || contribution.identity.basisDigest !== contribution.basis.basisDigest
    || contribution.assignment.basisDigest !== contribution.basis.basisDigest
    || contribution.assignment.workPacketDigest !== contribution.basis.work.packetCoreDigest
    || contribution.assignment.scopedDependencyDigest !== contribution.basis.work.scopedDependencyDigest
    || contribution.assignment.promptTemplateDigest !== contribution.basis.inputs.policyDigest) {
    return { contributionDigest: contribution.identity?.artifactDigest ?? null, reasonCode: "CONTRIBUTION_INTEGRITY_FAILURE" };
  }
  return operations.map((operation) => ({ ...operation }));
}

export function resolveContributions(contributions: readonly ResolvableContribution[]): Resolution {
  if (contributions.length === 0) throw new Error("RESOLVE_CONTRIBUTIONS_REQUIRED");
  for (const contribution of contributions) assertRealisationBasis((contribution as Contribution & { basis?: RealisationBasis }).basis);
  for (const contribution of contributions.slice(1)) assertSameBasis((contributions[0] as Contribution & { basis: RealisationBasis }).basis, (contribution as Contribution & { basis: RealisationBasis }).basis);
  const basis = (contributions[0] as Contribution & { basis: RealisationBasis }).basis;
  const sorted = [...contributions].sort((a, b) => a.identity.artifactDigest.localeCompare(b.identity.artifactDigest));
  const rejected: ResolutionRejection[] = [];
  const seen = new Map<string, string>();
  const accepted: ResolvableContribution[] = [];
  for (const contribution of sorted) {
    const operations = contributionOperations(contribution);
    if (!Array.isArray(operations)) { rejected.push(operations); continue; }
    const conflict = operations.find((operation) => seen.has(operation.path) || operations.filter((candidate) => candidate.path === operation.path).length > 1);
    if (conflict) {
      rejected.push({ contributionDigest: contribution.identity.artifactDigest, reasonCode: "OVERLAPPING_FILE_OPERATION", path: conflict.path });
      continue;
    }
    for (const operation of operations) seen.set(operation.path, contribution.identity.artifactDigest);
    accepted.push(contribution);
  }
  const acceptedDigests = accepted.map((contribution) => contribution.identity.artifactDigest);
  if (rejected.length > 0) return immutable({ schema: "urn:usf:resolve-result:1", basis, status: "refused", candidate: null, acceptedContributionDigests: acceptedDigests, rejected });
  const operations = [...seen.keys()].sort().map((path) => {
    const contribution = accepted.find((item) => item.identity.artifactDigest === seen.get(path));
    return contribution!.payload.operations.find((operation) => operation.path === path)!;
  }).map((operation) => ({ ...operation }));
  const candidateBasis = { basisDigest: basis.basisDigest, operations, acceptedContributionDigests: acceptedDigests };
  const candidate: Candidate = immutable({
    schema: "urn:usf:candidate:1", kind: "candidate", status: "resolved", basis, identity: { artifactDigest: digest(candidateBasis), basisDigest: basis.basisDigest },
    payload: { operations }, lineage: { acceptedContributionDigests: acceptedDigests, rejected: [] },
    claims: ["disjoint-contributions-deterministically-merged"],
    nonclaims: ["not-written-to-repository", "not-validated", "not-integrated"],
  });
  return immutable({ schema: "urn:usf:resolve-result:1", basis, status: "resolved", candidate, acceptedContributionDigests: acceptedDigests, rejected: [] });
}

// ---------------------------------------------------------------------------
// Registration-feature identity for the receipt-target registration seam.
//
// urn:usf:rule:provider-receipt-target-registration:1 binds the operator's
// static registration to two digests that must be equal across the preliminary
// and the final feature candidate. Candidate identity cannot serve that purpose
// because it binds basisDigest and acceptedContributionDigests, and the final
// candidate deliberately sits on a changed operator-predecessor basis. These
// two digests are therefore derived only from the semantic content of the
// feature: what it writes, and what state that produces across its exact
// declared write set.
//
// Preimages are declared, never inferred, following
// urn:usf:type:CanonicalKeyedMemberDigestProtocol:
//   urn:usf:provider-operation:registration-feature-operations-key:1
//   urn:usf:provider-operation:registration-feature-postimage-key:1
// ---------------------------------------------------------------------------

export type RegistrationFeatureOperationKind = "write" | "delete";

export interface RegistrationFeatureOperationInput {
  readonly kind: RegistrationFeatureOperationKind;
  readonly path: string;
  /** Exact resulting bytes; omit or null for a delete. */
  readonly content?: string | null;
}

export interface RegistrationFeatureOperationMember {
  readonly kind: RegistrationFeatureOperationKind;
  readonly path: string;
  readonly contentDigest: string | null;
}

export interface RegistrationFeaturePostimageMember {
  readonly path: string;
  readonly kind: RegistrationFeatureOperationKind | null;
  readonly resultingMode: "100644" | "100755" | null;
  readonly resultingContentDigest: string | null;
}

const registrationFeaturePathPattern = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).+$/u;

export class RegistrationFeatureError extends Error {
  readonly reasonCode: "UNDECLARED_WRITE";
  constructor(detail: string) {
    super(detail);
    this.name = "RegistrationFeatureError";
    this.reasonCode = "UNDECLARED_WRITE";
  }
}

function registrationFeatureRefuse(_reason: "UNDECLARED_WRITE", detail: string): never {
  throw new RegistrationFeatureError(detail);
}

function registrationFeaturePath(path: unknown, detail: string): string {
  if (typeof path !== "string" || path.length === 0 || !registrationFeaturePathPattern.test(path)) {
    registrationFeatureRefuse("UNDECLARED_WRITE", `Registration feature path is invalid: ${detail}`);
  }
  return path;
}

/**
 * Normalize resolved contribution operations into the declared operations
 * member set: path-ordered, content bound by digest, and closed against any
 * envelope field. `encoding` and `mediaType` are deliberately excluded because
 * they describe transport of the contribution, not the semantics of the feature.
 */
export function registrationFeatureOperations(
  operations: readonly RegistrationFeatureOperationInput[],
): readonly RegistrationFeatureOperationMember[] {
  const seen = new Set<string>();
  const members = operations.map((operation) => {
    const path = registrationFeaturePath(operation.path, String(operation.path));
    if (seen.has(path)) registrationFeatureRefuse("UNDECLARED_WRITE", `Duplicate registration feature operation: ${path}`);
    seen.add(path);
    if (operation.kind !== "write" && operation.kind !== "delete") {
      registrationFeatureRefuse("UNDECLARED_WRITE", `Unknown registration feature operation kind for ${path}`);
    }
    if (operation.kind === "write" && typeof operation.content !== "string") {
      registrationFeatureRefuse("UNDECLARED_WRITE", `Registration feature write without exact content: ${path}`);
    }
    if (operation.kind === "delete" && operation.content !== undefined && operation.content !== null) {
      registrationFeatureRefuse("UNDECLARED_WRITE", `Registration feature delete carries content: ${path}`);
    }
    return Object.freeze({
      kind: operation.kind,
      path,
      contentDigest: operation.kind === "write" ? digest(Buffer.from(operation.content as string, "utf8")) : null,
    });
  });
  return Object.freeze([...members].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0)));
}

export function registrationFeatureOperationsDigest(
  operations: readonly RegistrationFeatureOperationInput[],
): string {
  return canonicalDigest(registrationFeatureOperations(operations), { rejectAbsolutePaths: true });
}

/**
 * Project the feature's resulting state across its exact declared write set.
 * Every declared path appears exactly once in path order. A path the feature
 * does not operate on carries a canonical absence of effect rather than being
 * omitted, so the digest binds the intended scope as well as the resulting
 * state. An operation outside the declared write set refuses.
 */
export function registrationFeaturePostimageSet(
  declaredWriteSet: readonly string[],
  operations: readonly RegistrationFeatureOperationInput[],
  executableWritePaths: readonly string[] = [],
): readonly RegistrationFeaturePostimageMember[] {
  const declared = [...new Set(declaredWriteSet.map((path) => registrationFeaturePath(path, path)))].sort();
  if (declared.length !== declaredWriteSet.length) {
    registrationFeatureRefuse("UNDECLARED_WRITE", "Declared registration feature write set contains a duplicate path.");
  }
  const executable = new Set(executableWritePaths);
  const byPath = new Map<string, RegistrationFeatureOperationMember>();
  for (const member of registrationFeatureOperations(operations)) {
    if (!declared.includes(member.path)) {
      registrationFeatureRefuse("UNDECLARED_WRITE", `Registration feature operation outside the declared write set: ${member.path}`);
    }
    byPath.set(member.path, member);
  }
  return Object.freeze(declared.map((path) => {
    const operation = byPath.get(path);
    if (operation === undefined) {
      return Object.freeze({ path, kind: null, resultingMode: null, resultingContentDigest: null });
    }
    return Object.freeze({
      path,
      kind: operation.kind,
      resultingMode: operation.kind === "delete" ? null : (executable.has(path) ? "100755" as const : "100644" as const),
      resultingContentDigest: operation.contentDigest,
    });
  }));
}

export function registrationFeaturePostimageSetDigest(
  declaredWriteSet: readonly string[],
  operations: readonly RegistrationFeatureOperationInput[],
  executableWritePaths: readonly string[] = [],
): string {
  return canonicalDigest(registrationFeaturePostimageSet(declaredWriteSet, operations, executableWritePaths), { rejectAbsolutePaths: true });
}

/** Cross-phase equality: the seam refuses unless both digests match exactly. */
export function registrationFeatureDigestsEqual(
  preliminary: Readonly<{ operationsDigest: string; postimageSetDigest: string }>,
  final: Readonly<{ operationsDigest: string; postimageSetDigest: string }>,
): boolean {
  return preliminary.operationsDigest === final.operationsDigest
    && preliminary.postimageSetDigest === final.postimageSetDigest;
}
