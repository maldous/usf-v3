import type { FileOperation, WorkPacketForProposal } from "../../src/providers/types.ts";
import { createRealisationBasis, type RealisationBasis } from "../../src/realisation/basis.ts";

const digest = `sha256:${"1".repeat(64)}`;

export interface ProposalBasisOptions {
  readonly selection?: Partial<RealisationBasis["selection"]>;
}

export function proposalBasis(
  workId = "urn:fixture:work:proposal",
  packetCoreDigest = digest,
  options: ProposalBasisOptions = {},
): RealisationBasis {
  return createRealisationBasis({
    schema: "urn:usf:realisation-basis:1",
    selection: {
      manifestPath: "graph/manifests/self-host.json", manifestDigest: digest,
      profile: "urn:fixture:profile:proposal:1", profileVersion: "1", profileDigest: digest,
      product: "urn:fixture:product:proposal", productVersion: "1", productDigest: digest,
      foundation: "urn:usf:foundation:v3", foundationVersion: "3", foundationDigest: digest,
      coreToProductDigest: digest, productToCoreDigest: digest, compositeDigest: digest,
      ...options.selection,
    },
    authority: {
      contract: "urn:fixture:contract:proposal:1", contractDigest: digest,
      contractShape: "urn:usf:contract-shape:semantic-first:1",
      permission: "urn:fixture:permission:proposal", permissionDigest: digest,
      permissionState: "urn:usf:contract-state:active", maximumThrough: "check",
      effectiveAuthority: "active-permission", effectiveMaximumThrough: "check",
    },
    work: {
      id: workId, resourceDigest: digest, packetCoreDigest,
      semanticDigest: digest, scopedDependencyDigest: digest, dependencies: [],
    },
    semanticTrace: { policy: "urn:usf:policy:semantic-first:1", stages: [] },
    scope: { readSet: [], writeSet: [], preimages: {} },
    trace: { requirements: [], evidence: [], proof: [], validation: [] },
    inputs: { policyDigest: digest, schemaDigests: [], toolDigests: [] },
  });
}

export function proposalPacket(id: string, objective: string, permittedPaths: string[], proposedFileOperations: FileOperation[]): WorkPacketForProposal {
  return {
    id,
    objective,
    permittedPaths,
    decisionBoundary: { kind: "work", root: id },
    requirements: [],
    artifacts: [],
    readSet: [],
    constraints: [],
    acceptanceCriteria: [],
    validationPlan: [],
    proofObligations: [],
    modelCapabilities: ["typescript"],
    privacy: "public",
    environmentPosture: [{ environment: "urn:usf:environment:hermetic", applicability: "required" }],
    targetRuntimeProvider: "none",
    constructionRouteConstraints: ["zero-paid-cost"],
    outputSchema: "urn:usf:contribution:1",
    stopConditions: ["Stop after one deterministic proposal."],
    proposedFileOperations,
  };
}
