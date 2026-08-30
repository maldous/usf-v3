import { type Contribution, type FileOperation, contributionDigest, digest, immutable, isOperation } from "../providers/types.ts";

export interface Candidate {
  schema: "urn:usf:candidate:1";
  kind: "candidate";
  status: "resolved";
  identity: { artifactDigest: string };
  payload: { operations: readonly FileOperation[] };
  lineage: { acceptedContributionDigests: readonly string[]; rejected: readonly ResolutionRejection[] };
  claims: readonly string[];
  nonclaims: readonly string[];
}

export interface ResolutionRejection { contributionDigest: string | null; reasonCode: string; path?: string; }
export interface Resolution {
  schema: "urn:usf:resolve-result:1";
  status: "resolved" | "refused";
  candidate: Candidate | null;
  acceptedContributionDigests: readonly string[];
  rejected: readonly ResolutionRejection[];
}

function contributionOperations(contribution: Contribution): FileOperation[] | ResolutionRejection {
  const operations = contribution.payload?.operations;
  if (!Array.isArray(operations) || !operations.every(isOperation)) return { contributionDigest: contribution.identity?.artifactDigest ?? null, reasonCode: "MALFORMED_FILE_OPERATION" };
  if (contribution.schema !== "urn:usf:contribution:1" || contribution.kind !== "contribution" || !contribution.identity?.artifactDigest || contribution.identity.artifactDigest !== contributionDigest(contribution)) {
    return { contributionDigest: contribution.identity?.artifactDigest ?? null, reasonCode: "CONTRIBUTION_INTEGRITY_FAILURE" };
  }
  return operations.map((operation) => ({ ...operation }));
}

export function resolveContributions(contributions: readonly Contribution[]): Resolution {
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
  if (rejected.length > 0) return immutable({ schema: "urn:usf:resolve-result:1", status: "refused", candidate: null, acceptedContributionDigests: acceptedDigests, rejected });
  const operations = [...seen.keys()].sort().map((path) => {
    const contribution = accepted.find((item) => item.identity.artifactDigest === seen.get(path));
    return contribution!.payload.operations.find((operation) => operation.path === path)!;
  }).map((operation) => ({ ...operation }));
  const candidateBasis = { operations, acceptedContributionDigests: acceptedDigests };
  const candidate: Candidate = immutable({
    schema: "urn:usf:candidate:1", kind: "candidate", status: "resolved", identity: { artifactDigest: digest(candidateBasis) },
    payload: { operations }, lineage: { acceptedContributionDigests: acceptedDigests, rejected: [] },
    claims: ["disjoint-contributions-deterministically-merged"],
    nonclaims: ["not-written-to-repository", "not-validated", "not-integrated"],
  });
  return immutable({ schema: "urn:usf:resolve-result:1", status: "resolved", candidate, acceptedContributionDigests: acceptedDigests, rejected: [] });
}
