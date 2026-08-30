import { type Contribution, type FileOperation, contributionDigest, digest, immutable, isOperation } from "../providers/types.ts";
import { assertRealisationBasis, assertSameBasis, type RealisationBasis } from "../realisation/basis.ts";

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

function contributionOperations(contribution: Contribution): FileOperation[] | ResolutionRejection {
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

export function resolveContributions(contributions: readonly Contribution[]): Resolution {
  if (contributions.length === 0) throw new Error("RESOLVE_CONTRIBUTIONS_REQUIRED");
  for (const contribution of contributions) assertRealisationBasis((contribution as Contribution & { basis?: RealisationBasis }).basis);
  for (const contribution of contributions.slice(1)) assertSameBasis((contributions[0] as Contribution & { basis: RealisationBasis }).basis, (contribution as Contribution & { basis: RealisationBasis }).basis);
  const basis = (contributions[0] as Contribution & { basis: RealisationBasis }).basis;
  const sorted = [...contributions].sort((a, b) => a.identity.artifactDigest.localeCompare(b.identity.artifactDigest));
  const rejected: ResolutionRejection[] = [];
  const seen = new Map<string, string>();
  const accepted: Contribution[] = [];
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
