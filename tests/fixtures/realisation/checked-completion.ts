import { admissionCheckHandler } from "../../../src/commands/apply.ts";
import { evidenceCommandHandler, proveCommandHandler, constructionAwarePublishCommandHandler } from "../../../src/commands/construction-authority.ts";
import { realiseCommandHandler } from "../../../src/commands/work-completion.ts";
import { readGraphDerivedCheckReceipt, type CheckedCandidateReceipt } from "../../../src/commands/check.ts";

export interface FreshCheckedCompletionRequest {
  readonly work: string;
  readonly profile: string;
  readonly manifestPath: string;
  readonly validation: string;
  readonly constructionObligation: string;
  readonly name: string;
}

export interface FreshCheckedCompletion {
  readonly candidateDigest: string;
  readonly workspacePath: string;
  readonly receiptPath: string;
  readonly receipt: CheckedCandidateReceipt;
}

/** Build a current native construction/check receipt without using retained fixture receipt bytes. */
export async function freshCheckedCompletion(root: string, request: FreshCheckedCompletionRequest): Promise<FreshCheckedCompletion> {
  const constructionEvidencePath = `.usf/candidates/construction-authority/${request.name}-fresh-evidence.json`;
  const constructionBundlePath = `.usf/candidates/construction-authority/${request.name}-fresh-bundle.json`;
  await evidenceCommandHandler({ command: "evidence", repositoryRoot: root,
    args: ["construction", "--work", request.work, "--profile", request.profile, "--manifest", request.manifestPath, "--output", constructionEvidencePath] });
  await proveCommandHandler({ command: "prove", repositoryRoot: root,
    args: ["construction", "--obligation", request.constructionObligation, "--evidence", constructionEvidencePath, "--profile", request.profile, "--manifest", request.manifestPath, "--output", constructionBundlePath] });
  const construction = await constructionAwarePublishCommandHandler({ command: "publish", repositoryRoot: root,
    args: ["construction-authority", "--bundle", constructionBundlePath, "--profile", request.profile, "--manifest", request.manifestPath, "--apply"] });
  if ((construction.output as { status?: unknown }).status !== "ok") throw new Error("FRESH_CHECKED_COMPLETION_CONSTRUCTION_REFUSED");

  const realised = await realiseCommandHandler({ command: "realise", repositoryRoot: root,
    args: ["no-change", "--work", request.work, "--profile", request.profile, "--manifest", request.manifestPath] });
  const result = realised.output as { candidateDigest?: unknown; workspacePath?: unknown };
  if (typeof result.candidateDigest !== "string" || typeof result.workspacePath !== "string") throw new Error("FRESH_CHECKED_COMPLETION_REALISATION_INVALID");
  const checked = await admissionCheckHandler({ command: "check", repositoryRoot: root,
    args: ["--candidate", result.candidateDigest, "--validation", request.validation] });
  if ((checked.output as { status?: unknown }).status !== "pass") throw new Error("FRESH_CHECKED_COMPLETION_CHECK_REFUSED");
  const receipt = await readGraphDerivedCheckReceipt(root, result.candidateDigest, request.validation);
  if (receipt === null) throw new Error("FRESH_CHECKED_COMPLETION_RECEIPT_MISSING");
  return Object.freeze({ candidateDigest: result.candidateDigest, workspacePath: result.workspacePath, receiptPath: receipt.receiptPath, receipt: receipt.receipt });
}
