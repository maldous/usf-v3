import type { FileOperation, WorkPacketForProposal } from "../../src/providers/index.ts";

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
